from collections.abc import Mapping
from typing import Any


SUPPORTED_MOBILITY_TYPES = {"INDEPENDENT", "ASSISTED", "FAMILY_ASSISTED"}

MOBILITY_WEIGHTS = {
    "INDEPENDENT": {
        "distance": 1.2,
        "slope": 1.0,
        "surface": 0.8,
        "safety": 0.9,
        "barrier_free": 0.5,
        "rest": 0.4,
        "step": 0.8,
    },
    "ASSISTED": {
        "distance": 0.8,
        "slope": 1.4,
        "surface": 1.3,
        "safety": 1.3,
        "barrier_free": 1.2,
        "rest": 0.9,
        "step": 1.5,
    },
    "FAMILY_ASSISTED": {
        "distance": 0.9,
        "slope": 1.1,
        "surface": 1.0,
        "safety": 1.5,
        "barrier_free": 1.0,
        "rest": 1.1,
        "step": 1.2,
    },
}


def segment_cost(segment: Mapping[str, Any], mobility_type: str) -> float:
    weights = MOBILITY_WEIGHTS[mobility_type]
    distance_cost = float(segment["length_m"]) / 100
    slope_risk = float(segment["slope_percent"])
    surface_risk = 6 - int(segment["surface_level"])
    safety_risk = 6 - int(segment["safety_level"])
    barrier_free_risk = 6 - int(segment["barrier_free_level"])
    rest_risk = 6 - int(segment["rest_facility_score"])
    step_risk = int(segment["step_count"]) * 2
    return (
        weights["distance"] * distance_cost
        + weights["slope"] * slope_risk
        + weights["surface"] * surface_risk
        + weights["safety"] * safety_risk
        + weights["barrier_free"] * barrier_free_risk
        + weights["rest"] * rest_risk
        + weights["step"] * step_risk
    )


def route_score(segments: list[Mapping[str, Any]], mobility_type: str) -> float:
    return sum(segment_cost(segment, mobility_type) for segment in segments)


def enumerate_paths(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    max_depth: int = 8,
) -> list[list[Mapping[str, Any]]]:
    graph: dict[str, list[Mapping[str, Any]]] = {}
    for segment in segments:
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


def build_summary(path: list[Mapping[str, Any]]) -> str:
    avg_slope = sum(float(segment["slope_percent"]) for segment in path) / len(path)
    avg_surface = sum(int(segment["surface_level"]) for segment in path) / len(path)
    avg_safety = sum(int(segment["safety_level"]) for segment in path) / len(path)
    avg_rest = sum(int(segment["rest_facility_score"]) for segment in path) / len(path)
    total_steps = sum(int(segment["step_count"]) for segment in path)

    reasons = []
    if avg_slope <= 1.5:
        reasons.append("坡度较缓")
    if avg_surface >= 4:
        reasons.append("路面较平整")
    if avg_safety >= 4:
        reasons.append("安全性较好")
    if avg_rest >= 4:
        reasons.append("沿途休息点更友好")
    if total_steps > 0:
        reasons.append("存在台阶，需要注意")
    return "，".join(reasons) if reasons else "综合成本较低"


def recommend_routes(
    segments: list[Mapping[str, Any]],
    start_node_code: str,
    end_node_code: str,
    mobility_type: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    paths = enumerate_paths(segments, start_node_code, end_node_code)
    ranked = []
    for path in paths:
        score = route_score(path, mobility_type)
        ranked.append((score, path))
    ranked.sort(key=lambda item: item[0])

    routes = []
    for index, (score, path) in enumerate(ranked[:limit], start=1):
        distance_m = sum(float(segment["length_m"]) for segment in path)
        routes.append(
            {
                "rank": index,
                "route_score": round(score, 2),
                "distance_m": round(distance_m, 2),
                "estimated_minutes": max(1, round(distance_m / 60)),
                "segment_codes": [str(segment["segment_code"]) for segment in path],
                "segment_names": [segment.get("name") for segment in path],
                "summary": build_summary(path),
            }
        )
    return routes
