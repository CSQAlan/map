"""Opt-in real PostGIS check using temporary tables; no production rows change."""
import os
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import engine, get_db
from app.db import seeds
from app.main import app


@pytest.mark.skipif(os.environ.get("RUN_SURVEY_DB_TESTS") != "1", reason="Opt-in local PostGIS verification")
def test_real_survey_seed_and_unfiltered_api_preserve_manual_placement(monkeypatch):
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.exec_driver_sql("CREATE TEMP TABLE survey_site (LIKE public.survey_site INCLUDING ALL) ON COMMIT DROP")
            connection.exec_driver_sql("CREATE TEMP TABLE survey_record (LIKE public.survey_record INCLUDING ALL) ON COMMIT DROP")

            class TransactionEngine:
                @contextmanager
                def begin(self):
                    yield connection

            monkeypatch.setattr(seeds, "engine", TransactionEngine())
            assert seeds.seed_survey_records() == {"survey_sites": 7, "survey_records": 67}
            code = connection.execute(text("SELECT record_code FROM survey_record WHERE location IS NULL LIMIT 1")).scalar_one()
            connection.execute(text("""
                UPDATE survey_record SET location = ST_SetSRID(ST_MakePoint(106.31, 29.60), 4326),
                    location_source = 'MANUAL', review_status = 'REJECTED'
                WHERE record_code = :code
            """), {"code": code})
            seeds.seed_survey_records()
            saved = connection.execute(text("""
                SELECT ST_X(location), ST_Y(location), location_source, review_status
                FROM survey_record WHERE record_code = :code
            """), {"code": code}).one()
            assert tuple(saved) == (106.31, 29.60, "MANUAL", "REJECTED")

            def test_db():
                with Session(bind=connection) as session:
                    yield session

            previous_override = app.dependency_overrides.get(get_db)
            app.dependency_overrides[get_db] = test_db
            try:
                with TestClient(app) as client:
                    sites = client.get("/api/survey-records/sites")
                    response = client.get("/api/survey-records", params={"coordinate_system": "GCJ02"})
                assert sites.status_code == 200
                assert len(sites.json()) == 7
                assert response.status_code == 200
                assert len(response.json()["features"]) == 67
                assert response.json()["features"][0]["properties"]["evidence_photos"]
            finally:
                if previous_override is None:
                    app.dependency_overrides.pop(get_db, None)
                else:
                    app.dependency_overrides[get_db] = previous_override
        finally:
            transaction.rollback()
