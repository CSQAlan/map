"""Read-only seed/candidate preflight. Never imports application or DB modules."""
import argparse
import ast
from collections import Counter, defaultdict
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import sys

from shapely import wkt
from shapely.geometry import LineString, Point
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / 'backend/app/db/seed_data'
ENDPOINT_TOLERANCE_M = 5
NEIGHBORHOOD_M = 2000
NOTICE = '只读预检，任何结果均不等于审定、发布或已纳入导航；不判断无障碍或现场通行安全。'


def number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def coordinate(value):
    return (isinstance(value, list) and len(value) == 2
            and all(number(v) for v in value) and -180 <= value[0] <= 180 and -90 <= value[1] <= 90)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def source_valid(source):
    if not isinstance(source, dict) or source.get('method') not in ('field_trace', 'measured_survey') or not text(source.get('ref')):
        return False
    try:
        return isinstance(source.get('observed_on'), str) and date.fromisoformat(source['observed_on']).isoformat() == source['observed_on']
    except ValueError:
        return False


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('JSON 重复字段: ' + key)
        result[key] = value
    return result


def read_json(path):
    def bad_constant(value):
        raise ValueError('非有限 JSON 数值: ' + value)
    return json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=strict_object, parse_constant=bad_constant)


def load_baseline(seed_dir=SEED):
    """Read files directly, not seeds.py imports (which import a configured engine)."""
    files = {name: read_json(seed_dir / (name + '.json')) for name in ('core_nodes', 'core_segments', 'core_pois', 'pilot_areas', 'survey_records')}
    area = next(row for row in files['pilot_areas'] if row['area_code'] == 'SHIDAYUAN' and row['status'] == 'ACTIVE')
    boundary = wkt.loads(area['boundary_wkt'])
    if boundary.geom_type != 'Polygon' or boundary.is_empty or not boundary.is_valid:
        raise ValueError('基线边界不是有效 Polygon')
    nodes = files['core_nodes']
    segments = files['core_segments']
    if len({n['node_code'] for n in nodes}) != len(nodes) or len({s['segment_code'] for s in segments}) != len(segments):
        raise ValueError('基线 ID 重复')
    if any(not coordinate([n['lon'], n['lat']]) for n in nodes):
        raise ValueError('基线节点坐标无效')
    active_nodes = {n['node_code']: [n['lon'], n['lat']] for n in nodes if n.get('status', 'ACTIVE') == 'ACTIVE'}
    active_segments = [s for s in segments if s.get('status', 'ACTIVE') == 'ACTIVE']
    if any(s['start_node_code'] not in active_nodes or s['end_node_code'] not in active_nodes for s in active_segments):
        raise ValueError('现役基线端点无效')
    survey = files['survey_records']
    records = survey['records']
    # Parse a literal only. Do not execute the seed loader or activate legacy SQL.
    constants = ast.parse((ROOT / 'backend/app/db/seeds.py').read_text(encoding='utf-8'))
    legacy = next(ast.literal_eval(n.value) for n in constants.body if isinstance(n, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == 'LEGACY_CAMPUS_SEGMENT_CODES' for t in n.targets))
    if any(s['segment_code'] in legacy for s in active_segments):
        raise ValueError('旧校区停用路段混入现役基线')
    return dict(nodes=active_nodes, segments=active_segments, boundary=boundary,
                reserved_nodes={n['node_code'] for n in nodes}, reserved_segments={s['segment_code'] for s in segments} | set(legacy),
                summary=dict(area_code='SHIDAYUAN', crs='EPSG:4326', nodes=len(active_nodes), segments=len(active_segments),
                             pois=len(files['core_pois']), legacy_inactive_segments_excluded=len(legacy),
                             survey_sites=len(survey['sites']), survey_records=len(records),
                             pending_photos=sum(r['review_status'] == 'PENDING_REVIEW' for r in records),
                             photo_records_with_points=sum(r.get('initial_location') is not None for r in records),
                             photo_records_without_points=sum(r.get('initial_location') is None for r in records),
                             additional_measured_segments=0,
                             conclusion='照片清单不含实测线/路段表，没有可直接接入的新增路段。'),
                sha256={name + '.json': hashlib.sha256((seed_dir / (name + '.json')).read_bytes()).hexdigest() for name in files})


def metric_projection(boundary):
    center = boundary.centroid
    sx = 111320 * math.cos(math.radians(center.y))
    sy = 111320
    return lambda x, y, z=None: ((x - center.x) * sx, (y - center.y) * sy)


def missing_metrics(segment):
    missing, invalid = [], []
    validators = {
        'width_m': lambda v: number(v) and v > 0,
        'slope_percent': lambda v: number(v) and v >= 0,
        'step_count': lambda v: type(v) is int and v >= 0,
        'surface_type': text,
        'has_ramp': lambda v: type(v) is bool,
        'has_handrail': lambda v: type(v) is bool,
    }
    if type(segment.get('step_count')) is int and segment['step_count'] > 0:
        validators['step_height_cm'] = lambda v: number(v) and v > 0
    for field, valid in validators.items():
        if segment.get(field) is None:
            missing.append(field)
        elif not valid(segment[field]):
            invalid.append('指标格式/范围无效: ' + field)
    return missing, invalid


def preflight(batch, baseline):
    result = {key: [] for key in ('reviewable', 'missing_fields', 'disconnected', 'outside_boundary', 'invalid')}
    result.update(notice=NOTICE, batch_errors=[], limits=dict(endpoint_tolerance_m=ENDPOINT_TOLERANCE_M, neighborhood_m=NEIGHBORHOOD_M))
    if (not isinstance(batch, dict) or type(batch.get('format_version')) is not int or batch['format_version'] != 1
            or batch.get('crs') != 'EPSG:4326' or batch.get('area_code') != 'SHIDAYUAN'
            or not isinstance(batch.get('nodes'), list) or not isinstance(batch.get('segments'), list)):
        result['batch_errors'].append('要求 format_version=1、area_code=SHIDAYUAN、crs=EPSG:4326 和 nodes/segments 数组；不转换 GCJ。')
        return result
    project = metric_projection(baseline['boundary'])
    boundary = transform(project, baseline['boundary'])
    nodes = dict(baseline['nodes'])
    node_counts = Counter(n.get('node_code') for n in batch['nodes'] if isinstance(n, dict) and isinstance(n.get('node_code'), str))
    for index, node in enumerate(batch['nodes']):
        errors = []
        if not isinstance(node, dict):
            errors.append('节点必须为对象')
        else:
            code = node.get('node_code')
            if not text(code) or node_counts[code] != 1 or code in baseline['reserved_nodes']:
                errors.append('节点 ID 缺失/重复/覆盖基线')
            if not source_valid(node.get('source')):
                errors.append('新节点缺少实测来源、引用或日期')
            point = [node.get('lon'), node.get('lat')]
            if not coordinate(point):
                errors.append('节点必须为有效 WGS84 lon/lat')
            elif transform(project, Point(point)).distance(boundary) > NEIGHBORHOOD_M:
                errors.append('节点超出合理试点邻域，核对坐标或另立试点')
            if not errors:
                nodes[code] = point
        if errors:
            result['invalid'].append(dict(kind='node', index=index, candidate=node, reasons=errors))
    counts = Counter(s.get('segment_code') for s in batch['segments'] if isinstance(s, dict) and isinstance(s.get('segment_code'), str))
    pairs = Counter(tuple(sorted((s['start_node_code'], s['end_node_code']))) for s in batch['segments']
                    if isinstance(s, dict) and all(isinstance(s.get(k), str) for k in ('start_node_code', 'end_node_code')))
    existing_pairs = {frozenset((s['start_node_code'], s['end_node_code'])) for s in baseline['segments']}
    candidates = []
    for index, segment in enumerate(batch['segments']):
        errors = []
        entry = dict(kind='segment', index=index, candidate=segment)
        if not isinstance(segment, dict):
            result['invalid'].append(dict(**entry, reasons=['路段必须为对象']))
            continue
        code, start, end = (segment.get(k) for k in ('segment_code', 'start_node_code', 'end_node_code'))
        if not text(code) or counts[code] != 1 or code in baseline['reserved_segments']:
            errors.append('路段 ID 缺失/与基线或批次重复（含停用保留 ID）')
        endpoints_valid = all(isinstance(v, str) and v in nodes for v in (start, end))
        if not endpoints_valid or start == end:
            errors.append('两端必须引用不同的现役基线节点或本批有效实测节点')
        if isinstance(start, str) and isinstance(end, str):
            if frozenset((start, end)) in existing_pairs or pairs[tuple(sorted((start, end)))] > 1:
                errors.append('同端点边/反向边已存在；平行线需另行人工消歧，不作新增就绪')
        if not source_valid(segment.get('source')):
            errors.append('路段缺少实测线来源、引用或日期；照片点/推测直线不是实测线')
        geometry = segment.get('geometry')
        coords = geometry.get('coordinates') if isinstance(geometry, dict) else None
        line = None
        if (not isinstance(geometry, dict) or geometry.get('type') != 'LineString'
                or not isinstance(coords, list) or len(coords) < 2 or not all(coordinate(p) for p in coords)):
            errors.append('必须提供有效 WGS84 [lon,lat] LineString，不能由照片点自动连线')
        else:
            line = transform(project, LineString(coords))
            if not line.is_valid or not line.is_simple or line.length < 0.01:
                errors.append('线必须非零、有效且无自交/折返')
            if line.distance(boundary) > NEIGHBORHOOD_M or any(Point(project(*p)).distance(boundary) > NEIGHBORHOOD_M for p in coords):
                errors.append('线坐标超出合理试点邻域，核对坐标或另立试点')
            if endpoints_valid and (Point(project(*nodes[start])).distance(Point(project(*coords[0]))) > ENDPOINT_TOLERANCE_M
                                    or Point(project(*nodes[end])).distance(Point(project(*coords[-1]))) > ENDPOINT_TOLERANCE_M):
                errors.append('线的首尾与声明起终节点不贴合（5 米）；反向线须同步交换节点')
        missing, metric_errors = missing_metrics(segment)
        errors.extend(metric_errors)
        if errors:
            result['invalid'].append(dict(**entry, reasons=errors, missing_fields=missing))
            continue
        outside = (not boundary.covers(line)
                   or any(not boundary.covers(Point(project(*nodes[v]))) for v in (start, end)))
        entry.update(missing_fields=missing, length_m=round(line.length, 2), outside=outside,
                     start=start, end=end, reasons=[])
        candidates.append(entry)
    # Only valid in-boundary edges connect a component. Geometric crossings and
    # proximity do NOT connect; only explicit shared node IDs do.
    adjacency = defaultdict(set)
    for entry in candidates:
        if not entry['outside']:
            adjacency[entry['start']].add(entry['end'])
            adjacency[entry['end']].add(entry['start'])
    connected = {v for s in baseline['segments'] for v in (s['start_node_code'], s['end_node_code'])}
    stack = list(connected)
    while stack:
        for neighbor in adjacency[stack.pop()]:
            if neighbor not in connected:
                connected.add(neighbor)
                stack.append(neighbor)
    for entry in candidates:
        linked = entry['start'] in connected or entry['end'] in connected
        entry['connected_to_active_graph'] = linked
        if entry['outside']:
            entry['reasons'].append('区外：需人工扩区复核，不裁剪、不作为就绪连接桥')
            category = 'outside_boundary'
        elif not linked:
            entry['reasons'].append('该连通分量未通过有效区内批次边接回现役图；不作自动吸附或照片连线')
            category = 'disconnected'
        elif entry['missing_fields']:
            entry['reasons'].append('缺少登记指标，待补数据；不能当作无障碍')
            category = 'missing_fields'
        else:
            entry['reasons'].append('仅可提交人工复核；连通性仅指拓扑，不保证辅助设备通行')
            category = 'reviewable'
        result[category].append(entry)
    if not batch['segments']:
        result['batch_errors'].append('未提供实测路段，没有可直接接入的新增路段。')
    return result


def main():
    parser = argparse.ArgumentParser(description=NOTICE)
    parser.add_argument('--candidate', type=Path, help='显式提供实测候选 JSON；省略时只核对真实 seed 文件')
    args = parser.parse_args()
    try:
        baseline = load_baseline()
        report = dict(notice=NOTICE, baseline=baseline['summary'], baseline_sha256=baseline['sha256'])
        if args.candidate:
            report['candidate_report'] = preflight(read_json(args.candidate), baseline)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if args.candidate:
            check = report['candidate_report']
            return 2 if check['batch_errors'] or check['invalid'] else 1 if any(check[k] for k in ('missing_fields', 'disconnected', 'outside_boundary')) else 0
        return 0
    except (ValueError, KeyError, TypeError, OSError, StopIteration) as exc:
        print(json.dumps(dict(error=str(exc), notice=NOTICE), ensure_ascii=False))
        return 2


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
