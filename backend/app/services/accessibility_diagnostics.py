from collections.abc import Mapping
from typing import Any


PRIORITY_SCORE = {
    "HIGH": 0,
    "MEDIUM": 1,
    "LOW": 2,
}


def numeric(segment: Mapping[str, Any], key: str, default: float) -> float:
    value = segment.get(key, default)
    return default if value is None else float(value)


def integer(segment: Mapping[str, Any], key: str, default: int) -> int:
    value = segment.get(key, default)
    return default if value is None else int(value)


def boolean(segment: Mapping[str, Any], key: str, default: bool) -> bool:
    value = segment.get(key, default)
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def make_suggestion(
    segment: Mapping[str, Any],
    issue_type: str,
    priority: str,
    affected_profiles: list[str],
    problem: str,
    suggestion: str,
    evidence: list[str],
) -> dict[str, Any]:
    return {
        "segment_code": str(segment["segment_code"]),
        "segment_name": segment.get("name"),
        "issue_type": issue_type,
        "priority": priority,
        "affected_profiles": affected_profiles,
        "problem": problem,
        "suggestion": suggestion,
        "evidence": evidence,
    }


def diagnose_segment(segment: Mapping[str, Any]) -> list[dict[str, Any]]:
    suggestions = []
    step_count = integer(segment, "step_count", 0)
    has_ramp = boolean(segment, "has_ramp", False)
    has_handrail = boolean(segment, "has_handrail", False)
    width_m = numeric(segment, "width_m", 1.5)
    surface_level = integer(segment, "surface_level", 3)
    safety_level = integer(segment, "safety_level", 3)
    barrier_free_level = integer(segment, "barrier_free_level", 3)
    rest_score = integer(segment, "rest_facility_score", 3)
    bench_count = integer(segment, "bench_count", 0)
    shade = integer(segment, "shade_coverage_percent", 0)

    if step_count > 0 and not has_ramp:
        suggestions.append(
            make_suggestion(
                segment,
                "MISSING_RAMP",
                "HIGH",
                ["WHEELCHAIR", "CANE", "SLOW_WALKER"],
                "存在台阶且没有坡道，轮椅画像会被阻断，拐杖和慢行老人通行负担也较高。",
                "优先增设缓坡坡道，坡道入口处补充防滑提示和边缘保护。",
                [f"台阶数量 {step_count}", "未配置坡道"],
            )
        )

    if step_count > 0 and not has_handrail:
        suggestions.append(
            make_suggestion(
                segment,
                "MISSING_HANDRAIL",
                "HIGH" if step_count >= 2 else "MEDIUM",
                ["CANE", "SLOW_WALKER", "FAMILY_ASSISTED"],
                "存在台阶但缺少扶手，拐杖老人和慢行老人上下台阶稳定性不足。",
                "在台阶两侧增设连续扶手，并在起止处设置醒目标识。",
                [f"台阶数量 {step_count}", "未配置扶手"],
            )
        )

    if width_m < 1.2:
        suggestions.append(
            make_suggestion(
                segment,
                "NARROW_WIDTH",
                "HIGH",
                ["WHEELCHAIR", "FAMILY_ASSISTED"],
                "路宽不足 1.2 米，轮椅和陪同行走会出现会车困难。",
                "优先拓宽通行面；短期可设置单向通行提示或标记辅助通道。",
                [f"路宽 {width_m:.1f} 米", "轮椅通行推荐宽度不低于 1.2 米"],
            )
        )

    if surface_level < 4:
        suggestions.append(
            make_suggestion(
                segment,
                "POOR_SURFACE",
                "MEDIUM",
                ["WHEELCHAIR", "CANE", "SLOW_WALKER"],
                "路面平整度不足，轮椅颠簸和拐杖打滑风险增加。",
                "修补坑洼、松动砖面或高差位置，并优先使用防滑材料。",
                [f"路面平整度 {surface_level}/5"],
            )
        )

    if safety_level < 4:
        suggestions.append(
            make_suggestion(
                segment,
                "LOW_SAFETY",
                "MEDIUM",
                ["CANE", "SLOW_WALKER", "FAMILY_ASSISTED"],
                "安全等级偏低，老人独立或陪同行走时需要更多环境提示。",
                "补充照明、慢行提示、边界标线或人车分流提示。",
                [f"安全等级 {safety_level}/5"],
            )
        )

    if barrier_free_level < 4:
        suggestions.append(
            make_suggestion(
                segment,
                "LOW_BARRIER_FREE",
                "HIGH" if barrier_free_level <= 2 else "MEDIUM",
                ["WHEELCHAIR", "CANE"],
                "无障碍等级不足，会降低轮椅和拐杖画像的路线可达性。",
                "系统性检查坡道、缘石坡化、连续平整通道和无障碍标识。",
                [f"无障碍等级 {barrier_free_level}/5"],
            )
        )

    if rest_score < 3 and bench_count == 0:
        suggestions.append(
            make_suggestion(
                segment,
                "NO_REST_SEAT",
                "MEDIUM",
                ["SLOW_WALKER", "FAMILY_ASSISTED"],
                "休息设施不足，慢行老人连续步行压力较大。",
                "在路段中途或节点位置增设座椅，并保证座椅旁有轮椅停靠空间。",
                [f"休息设施评分 {rest_score}/5", "座椅数量 0"],
            )
        )

    if shade < 20:
        suggestions.append(
            make_suggestion(
                segment,
                "LOW_SHADE",
                "LOW",
                ["SLOW_WALKER", "INDEPENDENT"],
                "树荫覆盖不足，夏季或雨天舒适度较低。",
                "结合校园景观增设遮阴、雨棚或可停留休息点。",
                [f"树荫覆盖 {shade}%"],
            )
        )

    return suggestions


def diagnose_segments(
    segments: list[Mapping[str, Any]],
    limit: int = 8,
) -> list[dict[str, Any]]:
    suggestions = []
    for segment in segments:
        suggestions.extend(diagnose_segment(segment))

    suggestions.sort(
        key=lambda item: (
            PRIORITY_SCORE[item["priority"]],
            -len(item["affected_profiles"]),
            item["segment_code"],
            item["issue_type"],
        )
    )
    return suggestions[:limit]
