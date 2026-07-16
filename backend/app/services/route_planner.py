import json
import heapq
from collections.abc import Mapping
from typing import Any


SUPPORTED_MOBILITY_TYPES = {
    "INDEPENDENT",
    "SLOW_WALKER",
    "CANE",
    "WHEELCHAIR",
    "ASSISTED",
    "FAMILY_ASSISTED",
}

PROFILE_ALIASES = {
    "ASSISTED": "CANE",
}

SURFACE_DIFFICULTY = {
    "ASPHALT": 1.0,
    "CONCRETE": 1.0,
    "BRICK": 1.2,
    "GRAVEL": 1.6,
    "GRASS": 1.8,
    "WOOD": 1.1,
    "TILE": 1.0,
    "COBBLESTONE": 2.0,
}

DEFAULT_SURFACE_TYPE = "CONCRETE"

MOBILITY_PROFILES = {
    "INDEPENDENT": {
        "max_slope_percent": 12.0,
        "max_steps_without_ramp": 12,
        "min_width_m": 0.8,
        "min_barrier_free_level": 2,
        "require_wheelchair_accessible": False,
        "weights": {
            "distance": 1.2,
            "slope": 1.0,
            "surface": 0.8,
            "safety": 0.9,
            "barrier_free": 0.5,
            "rest": 0.4,
            "step": 0.8,
            "width": 0.4,
            "shade": -0.2,
            "bench": -0.2,
            "handrail": -0.2,
            "ramp": -0.2,
        },
    },
    "SLOW_WALKER": {
        "max_slope_percent": 6.5,
        "max_steps_without_ramp": 6,
        "min_width_m": 0.9,
        "min_barrier_free_level": 3,
        "require_wheelchair_accessible": False,
        "weights": {
            "distance": 0.9,
            "slope": 1.6,
            "surface": 1.3,
            "safety": 1.2,
            "barrier_free": 1.0,
            "rest": 1.5,
            "step": 1.8,
            "width": 0.8,
            "shade": -0.8,
            "bench": -0.9,
            "handrail": -0.5,
            "ramp": -0.3,
        },
    },
    "CANE": {
        "max_slope_percent": 8.0,
        "max_steps_without_ramp": 8,
        "min_width_m": 0.9,
        "min_barrier_free_level": 3,
        "require_wheelchair_accessible": False,
        "weights": {
            "distance": 0.85,
            "slope": 1.8,
            "surface": 1.4,
            "safety": 1.4,
            "barrier_free": 1.3,
            "rest": 1.0,
            "step": 3.2,
            "width": 1.0,
            "shade": -0.5,
            "bench": -0.5,
            "handrail": -1.0,
            "ramp": -0.8,
        },
    },
    "WHEELCHAIR": {
        "max_slope_percent": 5.0,
        "max_steps_without_ramp": 0,
        "min_width_m": 1.2,
        "min_barrier_free_level": 4,
        "require_wheelchair_accessible": True,
        "weights": {
            "distance": 0.75,
            "slope": 2.4,
            "surface": 1.8,
            "safety": 1.3,
            "barrier_free": 2.4,
            "rest": 0.8,
            "step": 100.0,
            "width": 2.6,
            "shade": -0.3,
            "bench": -0.2,
            "handrail": -0.2,
            "ramp": -1.8,
        },
    },
    "FAMILY_ASSISTED": {
        "max_slope_percent": 9.0,
        "max_steps_without_ramp": 10,
        "min_width_m": 0.9,
        "min_barrier_free_level": 3,
        "require_wheelchair_accessible": False,
        "weights": {
            "distance": 0.9,
            "slope": 1.2,
            "surface": 1.0,
            "safety": 1.6,
            "barrier_free": 1.0,
            "rest": 1.1,
            "step": 1.5,
            "width": 0.7,
            "shade": -0.5,
            "bench": -0.6,
            "handrail": -0.5,
            "ramp": -0.4,
        },
    },
}


def normalize_mobility_type(mobility_type: str) -> str:
    return PROFILE_ALIASES.get(mobility_type, mobility_type)


def numeric(segment: Mapping[str, Any], key: str, default: float) -> float:
    value = segment.get(key, default)
    return default if value is None else float(value)


def integer(segment: Mapping[str, Any], key: str, default: int) -> int:
    value = segment.get(key, default)
    return default if value is None else int(value)


def boolean(segment: Mapping[str, Any], key: str, default: bool) -> bool:
    value = segment.get(key, default)
    return default if value is None else bool(value)


def profile_for(mobility_type: str) -> dict[str, Any]:
    return MOBILITY_PROFILES[normalize_mobility_type(mobility_type)]


def is_segment_allowed(segment: Mapping[str, Any], mobility_type: str) -> bool:
    profile = profile_for(mobility_type)
    slope = numeric(segment, "slope_percent", 0)
    step_count = integer(segment, "step_count", 0)
    width_m = numeric(segment, "width_m", 1.5)
    barrier_free_level = integer(segment, "barrier_free_level", 3)
    has_ramp = boolean(segment, "has_ramp", False)

    if slope > float(profile["max_slope_percent"]):
        return False
    if width_m < float(profile["min_width_m"]):
        return False
    if barrier_free_level < int(profile["min_barrier_free_level"]):
        return False
    if step_count > int(profile["max_steps_without_ramp"]) and not has_ramp:
        return False
    if profile["require_wheelchair_accessible"]:
        if not boolean(segment, "wheelchair_accessible", False):
            return False
        if step_count > 0 and not has_ramp:
            return False
    return True


def segment_cost(segment: Mapping[str, Any], mobility_type: str) -> float:
    profile = profile_for(mobility_type)
    weights = profile["weights"]
    distance_cost = numeric(segment, "length_m", 0) / 100
    slope_risk = numeric(segment, "slope_percent", 0)
    surface_level_risk = 6 - integer(segment, "surface_level", 3)
    safety_risk = 6 - integer(segment, "safety_level", 3)
    barrier_free_risk = 6 - integer(segment, "barrier_free_level", 3)
    rest_risk = 6 - integer(segment, "rest_facility_score", 3)
    step_risk = integer(segment, "step_count", 0) * 2
    width_risk = max(0, float(profile["min_width_m"]) - numeric(segment, "width_m", 1.5)) * 4
    surface_type = str(segment.get("surface_type") or DEFAULT_SURFACE_TYPE).upper()
    surface_type_risk = SURFACE_DIFFICULTY.get(surface_type, 1.4) - 1

    shade_benefit = numeric(segment, "shade_coverage_percent", 0) / 25
    bench_benefit = min(integer(segment, "bench_count", 0), 3)
    handrail_benefit = 1 if boolean(segment, "has_handrail", False) else 0
    ramp_benefit = 1 if boolean(segment, "has_ramp", False) else 0

    raw_cost = (
        weights["distance"] * distance_cost
        + weights["slope"] * slope_risk
        + weights["surface"] * (surface_level_risk + surface_type_risk)
        + weights["safety"] * safety_risk
        + weights["barrier_free"] * barrier_free_risk
        + weights["rest"] * rest_risk
        + weights["step"] * step_risk
        + weights["width"] * width_risk
        + weights["shade"] * shade_benefit
        + weights["bench"] * bench_benefit
        + weights["handrail"] * handrail_benefit
        + weights["ramp"] * ramp_benefit
    )
    return max(0.1, raw_cost)


def segment_tags(segment: Mapping[str, Any], mobility_type: str) -> tuple[list[str], list[str]]:
    profile = profile_for(mobility_type)
    normalized_type = normalize_mobility_type(mobility_type)
    risk_tags = []
    benefit_tags = []

    slope = numeric(segment, "slope_percent", 0)
    step_count = integer(segment, "step_count", 0)
    width_m = numeric(segment, "width_m", 1.5)
    surface_level = integer(segment, "surface_level", 3)
    safety_level = integer(segment, "safety_level", 3)
    barrier_free_level = integer(segment, "barrier_free_level", 3)
    rest_score = integer(segment, "rest_facility_score", 3)
    shade = integer(segment, "shade_coverage_percent", 0)
    bench_count = integer(segment, "bench_count", 0)
    has_ramp = boolean(segment, "has_ramp", False)
    has_handrail = boolean(segment, "has_handrail", False)
    wheelchair_accessible = boolean(segment, "wheelchair_accessible", False)

    if slope <= 1.5:
        benefit_tags.append("坡度平缓")
    elif slope >= 3:
        risk_tags.append("坡度偏高")

    if step_count > 0:
        if has_ramp:
            benefit_tags.append("台阶旁有坡道")
        else:
            risk_tags.append("存在台阶")

    if width_m >= 1.5:
        benefit_tags.append("通行宽")
    elif width_m < float(profile["min_width_m"]) + 0.2:
        risk_tags.append("通行较窄")

    if surface_level >= 4:
        benefit_tags.append("路面平整")
    elif surface_level <= 3:
        risk_tags.append("路面一般")

    if safety_level >= 4:
        benefit_tags.append("安全性较好")
    else:
        risk_tags.append("安全一般")

    if barrier_free_level >= 4:
        benefit_tags.append("无障碍较好")
    else:
        risk_tags.append("无障碍一般")

    if rest_score >= 4 or bench_count > 0:
        benefit_tags.append("可中途休息")

    if shade >= 40:
        benefit_tags.append("树荫较好")

    if has_handrail:
        benefit_tags.append("有扶手")

    if has_ramp:
        benefit_tags.append("有坡道")

    if normalized_type == "WHEELCHAIR" and wheelchair_accessible:
        benefit_tags.append("轮椅可通行")

    return risk_tags, benefit_tags


def segment_explanation(segment: Mapping[str, Any], mobility_type: str) -> str:
    risk_tags, benefit_tags = segment_tags(segment, mobility_type)
    if risk_tags and benefit_tags:
        return f"优势：{'、'.join(benefit_tags[:3])}；需注意：{'、'.join(risk_tags[:2])}。"
    if benefit_tags:
        return f"这段路{'、'.join(benefit_tags[:4])}，适合作为推荐路段。"
    if risk_tags:
        return f"这段路存在{'、'.join(risk_tags[:3])}，建议慢行并注意安全。"
    return "这段路综合风险较低。"


def segment_avoidance_reasons(
    segment: Mapping[str, Any],
    mobility_type: str,
) -> tuple[str | None, list[str]]:
    normalized_type = normalize_mobility_type(mobility_type)
    profile = profile_for(normalized_type)
    reasons = []

    slope = numeric(segment, "slope_percent", 0)
    step_count = integer(segment, "step_count", 0)
    width_m = numeric(segment, "width_m", 1.5)
    surface_level = integer(segment, "surface_level", 3)
    safety_level = integer(segment, "safety_level", 3)
    barrier_free_level = integer(segment, "barrier_free_level", 3)
    rest_score = integer(segment, "rest_facility_score", 3)
    shade = integer(segment, "shade_coverage_percent", 0)
    bench_count = integer(segment, "bench_count", 0)
    crossing_safety = integer(segment, "crossing_safety_level", 3)
    has_ramp = boolean(segment, "has_ramp", False)
    has_handrail = boolean(segment, "has_handrail", False)
    wheelchair_accessible = boolean(segment, "wheelchair_accessible", False)

    if slope > float(profile["max_slope_percent"]):
        reasons.append(f"坡度 {slope:.1f}% 超过该画像上限 {float(profile['max_slope_percent']):.1f}%")
    if width_m < float(profile["min_width_m"]):
        reasons.append(f"路宽 {width_m:.1f} 米低于该画像最低要求 {float(profile['min_width_m']):.1f} 米")
    if barrier_free_level < int(profile["min_barrier_free_level"]):
        reasons.append(
            f"无障碍等级 {barrier_free_level} 低于该画像最低要求 {int(profile['min_barrier_free_level'])}"
        )
    if step_count > int(profile["max_steps_without_ramp"]) and not has_ramp:
        reasons.append("存在台阶且没有坡道，通行负担较高")
    if profile["require_wheelchair_accessible"] and not wheelchair_accessible:
        reasons.append("该路段标记为轮椅不可通行")

    if reasons:
        return "BLOCKED", reasons

    if normalized_type == "WHEELCHAIR":
        if slope >= 3:
            reasons.append("坡度偏高，轮椅通行需要更谨慎")
        if surface_level <= 3:
            reasons.append("路面平整度一般，轮椅颠簸风险较高")
        if rest_score <= 2:
            reasons.append("沿途休息条件较弱")
    elif normalized_type == "CANE":
        if step_count > 0 and not has_handrail:
            reasons.append("存在台阶且缺少扶手，拐杖老人通行风险较高")
        if slope >= 4:
            reasons.append("坡度偏高，拐杖老人上下坡压力较大")
        if surface_level <= 3:
            reasons.append("路面平整度一般，拐杖支撑稳定性较弱")
    elif normalized_type == "SLOW_WALKER":
        if rest_score <= 2 and bench_count == 0:
            reasons.append("休息设施不足，慢行老人中途恢复不方便")
        if slope >= 4:
            reasons.append("坡度偏高，慢行老人持续步行压力较大")
        if shade < 20:
            reasons.append("树荫覆盖较少，晴热天气舒适度较低")
    elif normalized_type == "FAMILY_ASSISTED":
        if safety_level <= 2 or crossing_safety <= 2:
            reasons.append("安全或过街条件偏弱，家属陪同步行仍需绕避")
        if step_count > 0 and not has_ramp:
            reasons.append("存在台阶且没有坡道，陪同通行不稳定")
    else:
        if safety_level <= 2:
            reasons.append("安全等级偏低")
        if surface_level <= 2:
            reasons.append("路面平整度较差")

    return ("HIGH_RISK", reasons) if reasons else (None, [])


def explain_avoided_segments(
    segments: list[Mapping[str, Any]],
    mobility_type: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    explanations = []
    for segment in segments:
        avoidance_level, reasons = segment_avoidance_reasons(segment, mobility_type)
        if not avoidance_level:
            continue
        explanations.append(
            {
                "segment_code": str(segment["segment_code"]),
                "name": segment.get("name"),
                "avoidance_level": avoidance_level,
                "reasons": reasons,
            }
        )

    explanations.sort(key=lambda item: 0 if item["avoidance_level"] == "BLOCKED" else 1)
    return explanations[:limit]


def build_segment_detail(segment: Mapping[str, Any], mobility_type: str) -> dict[str, Any]:
    risk_tags, benefit_tags = segment_tags(segment, mobility_type)
    geometry_coordinates = []
    geom_geojson = segment.get("geom_geojson")
    if geom_geojson:
        geometry_coordinates = json.loads(str(geom_geojson)).get("coordinates", [])
    return {
        "segment_code": str(segment["segment_code"]),
        "name": segment.get("name"),
        "geometry_coordinates": geometry_coordinates,
        "length_m": round(numeric(segment, "length_m", 0), 2),
        "slope_percent": round(numeric(segment, "slope_percent", 0), 2),
        "width_m": round(numeric(segment, "width_m", 1.5), 2),
        "step_count": integer(segment, "step_count", 0),
        "has_ramp": boolean(segment, "has_ramp", False),
        "has_handrail": boolean(segment, "has_handrail", False),
        "wheelchair_accessible": boolean(segment, "wheelchair_accessible", False),
        "risk_tags": risk_tags,
        "benefit_tags": benefit_tags,
        "explanation": segment_explanation(segment, mobility_type),
    }


def route_score(segments: list[Mapping[str, Any]], mobility_type: str) -> float:
    return sum(segment_cost(segment, mobility_type) for segment in segments)


def edge_key(segment: Mapping[str, Any]) -> tuple[str, str, str]:
    return (
        str(segment["start_node_code"]),
        str(segment["end_node_code"]),
        str(segment["segment_code"]),
    )


def path_signature(path: list[Mapping[str, Any]]) -> tuple[str, ...]:
    return tuple(str(segment["segment_code"]) for segment in path)


def build_allowed_graph(
    segments: list[Mapping[str, Any]],
    mobility_type: str,
    blocked_edges: set[tuple[str, str, str]] | None = None,
    blocked_nodes: set[str] | None = None,
) -> dict[str, list[Mapping[str, Any]]]:
    blocked_edges = blocked_edges or set()
    blocked_nodes = blocked_nodes or set()
    graph: dict[str, list[Mapping[str, Any]]] = {}
    for segment in segments:
        start_node = str(segment["start_node_code"])
        end_node = str(segment["end_node_code"])
        if start_node in blocked_nodes or end_node in blocked_nodes:
            continue
        if edge_key(segment) in blocked_edges:
            continue
        if is_segment_allowed(segment, mobility_type):
            graph.setdefault(start_node, []).append(segment)

    for outgoing_segments in graph.values():
        outgoing_segments.sort(key=lambda segment: str(segment["segment_code"]))
    return graph


def dijkstra_path(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    mobility_type: str = "INDEPENDENT",
    blocked_edges: set[tuple[str, str, str]] | None = None,
    blocked_nodes: set[str] | None = None,
) -> list[Mapping[str, Any]]:
    if start_node_code == end_node_code:
        return []

    graph = build_allowed_graph(segments, mobility_type, blocked_edges, blocked_nodes)
    best_cost_by_node: dict[str, float] = {start_node_code: 0.0}
    queue: list[tuple[float, int, str, list[Mapping[str, Any]]]] = [(0.0, 0, start_node_code, [])]
    sequence = 1

    while queue:
        cost, _, current_node, path = heapq.heappop(queue)
        if cost > best_cost_by_node.get(current_node, float("inf")):
            continue
        if current_node == end_node_code:
            return path

        visited_nodes = {str(segment["start_node_code"]) for segment in path}
        visited_nodes.add(current_node)
        for segment in graph.get(current_node, []):
            next_node = str(segment["end_node_code"])
            if next_node in visited_nodes:
                continue
            next_cost = cost + segment_cost(segment, mobility_type)
            if next_cost >= best_cost_by_node.get(next_node, float("inf")):
                continue
            best_cost_by_node[next_node] = next_cost
            heapq.heappush(queue, (next_cost, sequence, next_node, [*path, segment]))
            sequence += 1

    return []


def top_k_dijkstra_paths(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    mobility_type: str,
    limit: int = 3,
) -> list[list[Mapping[str, Any]]]:
    first_path = dijkstra_path(segments, start_node_code, end_node_code, mobility_type)
    if not first_path:
        return []

    accepted_paths = [first_path]
    accepted_signatures = {path_signature(first_path)}
    candidates: list[tuple[float, int, list[Mapping[str, Any]]]] = []
    candidate_signatures = set()
    sequence = 0

    while len(accepted_paths) < limit:
        base_path = accepted_paths[-1]
        for spur_index in range(len(base_path)):
            root_path = base_path[:spur_index]
            spur_node = str(base_path[spur_index]["start_node_code"])
            blocked_edges = set()
            blocked_nodes = {str(segment["start_node_code"]) for segment in root_path}

            for accepted_path in accepted_paths:
                if path_signature(accepted_path[:spur_index]) == path_signature(root_path):
                    if spur_index < len(accepted_path):
                        blocked_edges.add(edge_key(accepted_path[spur_index]))

            spur_path = dijkstra_path(
                segments,
                spur_node,
                end_node_code,
                mobility_type,
                blocked_edges=blocked_edges,
                blocked_nodes=blocked_nodes,
            )
            if not spur_path:
                continue
            candidate_path = [*root_path, *spur_path]
            signature = path_signature(candidate_path)
            if signature in accepted_signatures or signature in candidate_signatures:
                continue
            candidate_signatures.add(signature)
            heapq.heappush(
                candidates,
                (route_score(candidate_path, mobility_type), sequence, candidate_path),
            )
            sequence += 1

        if not candidates:
            break
        _, _, next_path = heapq.heappop(candidates)
        accepted_paths.append(next_path)
        accepted_signatures.add(path_signature(next_path))

    return accepted_paths[:limit]


def enumerate_paths(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    mobility_type: str = "INDEPENDENT",
    max_depth: int = 8,
) -> list[list[Mapping[str, Any]]]:
    graph: dict[str, list[Mapping[str, Any]]] = {}
    for segment in segments:
        if is_segment_allowed(segment, mobility_type):
            graph.setdefault(str(segment["start_node_code"]), []).append(segment)

    paths: list[list[Mapping[str, Any]]] = []

    def dfs(current_node: str, visited: set[str], path: list[Mapping[str, Any]]) -> None:
        if len(path) > max_depth:
            return
        if current_node == end_node_code:
            paths.append(path.copy())
            return
        for segment in graph.get(current_node, []):
            next_node = str(segment["end_node_code"])
            if next_node in visited:
                continue
            path.append(segment)
            visited.add(next_node)
            dfs(next_node, visited, path)
            visited.remove(next_node)
            path.pop()

    dfs(start_node_code, {start_node_code}, [])
    return paths


def build_summary(path: list[Mapping[str, Any]], mobility_type: str) -> str:
    avg_slope = sum(numeric(segment, "slope_percent", 0) for segment in path) / len(path)
    avg_surface = sum(integer(segment, "surface_level", 3) for segment in path) / len(path)
    avg_safety = sum(integer(segment, "safety_level", 3) for segment in path) / len(path)
    avg_rest = sum(integer(segment, "rest_facility_score", 3) for segment in path) / len(path)
    total_steps = sum(integer(segment, "step_count", 0) for segment in path)
    min_width = min(numeric(segment, "width_m", 1.5) for segment in path)
    has_ramps = any(boolean(segment, "has_ramp", False) for segment in path)
    has_handrails = any(boolean(segment, "has_handrail", False) for segment in path)
    avg_shade = sum(numeric(segment, "shade_coverage_percent", 0) for segment in path) / len(path)

    reasons = []
    if mobility_type == "WHEELCHAIR":
        reasons.append("轮椅可通行")
    if avg_slope <= 1.5:
        reasons.append("坡度较缓")
    if avg_surface >= 4:
        reasons.append("路面较平整")
    if avg_safety >= 4:
        reasons.append("安全性较好")
    if avg_rest >= 4:
        reasons.append("沿途休息点更友好")
    if min_width >= 1.2:
        reasons.append("通行宽度较充足")
    if has_ramps:
        reasons.append("包含坡道")
    if has_handrails:
        reasons.append("有扶手辅助")
    if avg_shade >= 40:
        reasons.append("树荫覆盖较好")
    if total_steps > 0:
        reasons.append("存在台阶，需注意")
    return "，".join(reasons) if reasons else "综合适老成本较低"


def recommend_routes(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    mobility_type: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    paths = top_k_dijkstra_paths(segments, start_node_code, end_node_code, mobility_type, limit)
    ranked = []
    for path in paths:
        score = route_score(path, mobility_type)
        ranked.append((score, path))
    ranked.sort(key=lambda item: item[0])

    routes = []
    for index, (score, path) in enumerate(ranked[:limit], start=1):
        distance_m = sum(numeric(segment, "length_m", 0) for segment in path)
        routes.append(
            {
                "rank": index,
                "route_score": round(score, 2),
                "distance_m": round(distance_m, 2),
                "estimated_minutes": max(1, round(distance_m / 60)),
                "segment_codes": [str(segment["segment_code"]) for segment in path],
                "segment_names": [segment.get("name") for segment in path],
                "segments": [
                    build_segment_detail(segment, normalize_mobility_type(mobility_type))
                    for segment in path
                ],
                "summary": build_summary(path, normalize_mobility_type(mobility_type)),
            }
        )
    return routes
