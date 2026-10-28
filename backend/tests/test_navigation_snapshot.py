from types import SimpleNamespace
import json
import pytest
from fastapi import HTTPException
from app.api.routes.auth import save_navigation_status
from app.schemas.auth import NavigationStatusRequest

class SnapshotDatabase:
    def __init__(self, revision):
        self.profile={'navigation_status':{'snapshot_revision':revision,'status':'COMPLETED'},'other':'preserved'}
        self.updates=[]
    def execute(self, statement, params):
        if str(statement).startswith('SELECT'):
            assert 'FOR UPDATE' in str(statement)
            return SimpleNamespace(mappings=lambda:SimpleNamespace(first=lambda:{'route_weight_profile':self.profile}))
        self.updates.append(json.loads(params['data']))
    def commit(self):
        pass

@pytest.mark.parametrize('revision',[None,99,100])
def test_completed_navigation_rejects_late_or_unversioned_snapshots(revision):
    db=SnapshotDatabase(100)
    payload=NavigationStatusRequest(start_name='起点',end_name='终点',snapshot_revision=revision)
    with pytest.raises(HTTPException) as error:
        save_navigation_status(42,payload,db)
    assert error.value.status_code==409
    assert not db.updates

def test_new_snapshot_advances_atomically_and_preserves_profile_data():
    db=SnapshotDatabase(100)
    payload=NavigationStatusRequest(start_name='起点',end_name='终点',snapshot_revision=101)
    result=save_navigation_status(42,payload,db)
    assert result['snapshot_revision']==101
    assert db.updates[0]['other']=='preserved'
