"""Offline registered lengths only; no application/config/database imports."""
import json
from pathlib import Path
from decimal import Decimal

import pytest
from app.services.rest_route_preview import rest_route_preview, _registered_lengths
from app.schemas.routes import RestRoutePreviewResponse


def edge(code, a, b, length):
    return dict(segment_code=code, start_node_code=a, end_node_code=b, length_m=length,
                name=code, width_m=3, slope_percent=0, step_count=0, barrier_free_level=4)


def preview(first=100, second=100):
    return rest_route_preview([edge('sr','S','R',first),edge('rt','R','T',second)],
                              'S','T','SLOW_WALKER','BALANCED',[dict(name='synthetic rest',linked_node_code='R')])


def test_ordered_real_lengths_serialize_without_inference_and_old_dto_still_valid():
    result=preview()
    assert result['segment_lengths_m']==[100,100]
    assert result['stop_after_segment_index']==0
    assert RestRoutePreviewResponse(**result).segment_lengths_m==[100,100]
    old=dict(result); del old['segment_lengths_m']
    assert RestRoutePreviewResponse(**old).segment_lengths_m is None
    assert _registered_lengths([dict(length_m=Decimal('1.25'))])==[1.25]


@pytest.mark.parametrize('value',[None,0,-1,False,'10',float('nan'),float('inf')])
def test_missing_or_non_real_positive_lengths_never_supply_budget_data(value):
    assert _registered_lengths([dict(length_m=value),dict(length_m=10)]) is None


@pytest.mark.parametrize('value',[None,0,-1])
def test_zero_or_missing_leg_cannot_create_a_usable_rest_candidate(value):
    assert preview(value,100) is None


def test_destination_rest_is_not_an_intermediate_stop_and_profile_is_not_relaxed():
    segments=[edge('st','S','T',100)]
    assert rest_route_preview(segments,'S','T','SLOW_WALKER','BALANCED',[dict(name='destination',linked_node_code='T')]) is None
    assert rest_route_preview(segments,'S','T','WHEELCHAIR','BALANCED',[dict(name='rest',linked_node_code='R')]) is None


def test_real_seed_two_legs_270_and_174_total444_longest270_worse_than246():
    folder=Path(__file__).parents[1]/'app/db/seed_data'
    segments=json.loads((folder/'core_segments.json').read_text(encoding='utf8'))
    pois=json.loads((folder/'core_pois.json').read_text(encoding='utf8'))
    result=rest_route_preview(segments,'N_SY_GATE_WEST','N_SY_LOTUS_ENTRY','SLOW_WALKER','BALANCED',
                              [p for p in pois if p['poi_type']=='REST_AREA'])
    split=result['stop_after_segment_index']+1
    first=sum(result['segment_lengths_m'][:split]); second=sum(result['segment_lengths_m'][split:])
    assert (first,second,result['distance_m'])==(270,174,444)
    assert max(first,second)-result['baseline_distance_m']==24
    assert not max(first,second)<=200
    assert max(first,second)<=300
