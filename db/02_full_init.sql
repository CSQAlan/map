-- Full database initialization for the elder map MVP.

-- Generated from db/01_init_schema.sql and backend/app/db/seed_data/*.json.

SET client_encoding = 'UTF8';

-- 助老地图 MVP 初始化数据库脚本
-- 试点范围：师大苑小区入口 / 荷塘休息区 / 外部商业街
-- 目标数据库：PostgreSQL 16 + PostGIS

CREATE EXTENSION IF NOT EXISTS postgis;

-- 统一的 updated_at 自动更新时间函数
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================
-- 1. 用户与画像
-- =========================

CREATE TABLE IF NOT EXISTS app_user (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    phone VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_app_user_username UNIQUE (username),
    CONSTRAINT ck_app_user_role CHECK (role IN ('ELDER', 'FAMILY', 'ADMIN', 'COLLECTOR')),
    CONSTRAINT ck_app_user_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

ALTER TABLE app_user DROP CONSTRAINT IF EXISTS ck_app_user_role;
ALTER TABLE app_user ADD CONSTRAINT ck_app_user_role
    CHECK (role IN ('ELDER', 'FAMILY', 'ADMIN', 'COLLECTOR'));

CREATE TABLE IF NOT EXISTS elder_profile (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    mobility_type VARCHAR(30) NOT NULL,
    needs_cane BOOLEAN NOT NULL DEFAULT FALSE,
    uses_wheelchair BOOLEAN NOT NULL DEFAULT FALSE,
    max_slope_percent NUMERIC(5,2),
    max_walk_distance_m INTEGER,
    prefer_rest_facility BOOLEAN NOT NULL DEFAULT TRUE,
    prefer_safer_crossing BOOLEAN NOT NULL DEFAULT TRUE,
    voice_first BOOLEAN NOT NULL DEFAULT TRUE,
    route_weight_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_elder_profile_user_id UNIQUE (user_id),
    CONSTRAINT fk_elder_profile_user_id FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT ck_elder_profile_mobility_type CHECK (
        mobility_type IN ('INDEPENDENT', 'ASSISTED', 'FAMILY_ASSISTED')
    ),
    CONSTRAINT ck_elder_profile_max_walk_distance_m CHECK (
        max_walk_distance_m IS NULL OR max_walk_distance_m >= 0
    ),
    CONSTRAINT ck_elder_profile_max_slope_percent CHECK (
        max_slope_percent IS NULL OR max_slope_percent >= 0
    )
);

CREATE TABLE IF NOT EXISTS family_binding (
    id BIGSERIAL PRIMARY KEY,
    elder_user_id BIGINT NOT NULL,
    family_user_id BIGINT NOT NULL,
    relation_type VARCHAR(20) NOT NULL DEFAULT 'CHILD',
    is_emergency_contact BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_family_binding_elder_user_id FOREIGN KEY (elder_user_id) REFERENCES app_user(id),
    CONSTRAINT fk_family_binding_family_user_id FOREIGN KEY (family_user_id) REFERENCES app_user(id),
    CONSTRAINT ck_family_binding_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_family_binding_relation_type CHECK (
        relation_type IN ('CHILD', 'SPOUSE', 'RELATIVE', 'CAREGIVER', 'OTHER')
    ),
    CONSTRAINT ck_family_binding_not_self CHECK (elder_user_id <> family_user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_role ON app_user(role);
CREATE INDEX IF NOT EXISTS idx_family_binding_elder_user_id ON family_binding(elder_user_id);
CREATE INDEX IF NOT EXISTS idx_family_binding_family_user_id ON family_binding(family_user_id);

-- =========================
-- 2. POI 与路网
-- =========================

CREATE TABLE IF NOT EXISTS pilot_area (
    id BIGSERIAL PRIMARY KEY,
    area_code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    boundary_geom GEOMETRY(Polygon, 4326) NOT NULL,
    center_geom GEOMETRY(Point, 4326) NOT NULL,
    min_zoom SMALLINT NOT NULL DEFAULT 16,
    max_zoom SMALLINT NOT NULL DEFAULT 20,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_pilot_area_area_code UNIQUE (area_code),
    CONSTRAINT ck_pilot_area_zoom CHECK (min_zoom BETWEEN 2 AND 20 AND max_zoom BETWEEN min_zoom AND 20),
    CONSTRAINT ck_pilot_area_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX IF NOT EXISTS gist_pilot_area_boundary_geom ON pilot_area USING GIST (boundary_geom);

CREATE TABLE IF NOT EXISTS poi_facility (
    id BIGSERIAL PRIMARY KEY,
    pilot_area_id BIGINT,
    name VARCHAR(100) NOT NULL,
    poi_type VARCHAR(30) NOT NULL,
    description VARCHAR(255),
    geom GEOMETRY(Point, 4326) NOT NULL,
    address_text VARCHAR(255),
    linked_node_code VARCHAR(50),
    is_accessible BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    source_provider VARCHAR(30) NOT NULL DEFAULT 'manual_photo',
    source_coord_type VARCHAR(30) NOT NULL DEFAULT 'wgs84',
    source_ref VARCHAR(255),
    evidence_photo_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_confidence SMALLINT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_poi_facility_poi_type CHECK (
        poi_type IN (
            'GATE', 'CLINIC', 'CANTEEN', 'BUS_STOP', 'REST_SEAT', 'TOILET', 'RAMP',
            'ENTRANCE', 'BUILDING_GROUP', 'REST_AREA', 'SERVICE_ACCESS', 'WAYPOINT'
        )
    ),
    CONSTRAINT ck_poi_facility_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_poi_facility_source CHECK (source IN ('OSM', 'MANUAL', 'DERIVED')),
    CONSTRAINT ck_poi_facility_data_confidence CHECK (data_confidence BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS gist_poi_facility_geom ON poi_facility USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_poi_facility_poi_type ON poi_facility(poi_type);

CREATE TABLE IF NOT EXISTS road_node (
    id BIGSERIAL PRIMARY KEY,
    pilot_area_id BIGINT,
    osm_node_ref VARCHAR(50),
    name VARCHAR(100),
    geom GEOMETRY(Point, 4326) NOT NULL,
    node_type VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    source_provider VARCHAR(30) NOT NULL DEFAULT 'manual_photo',
    source_coord_type VARCHAR(30) NOT NULL DEFAULT 'wgs84',
    source_ref VARCHAR(255),
    data_confidence SMALLINT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_road_node_node_type CHECK (
        node_type IN ('NORMAL', 'GATE', 'CROSSING', 'POI_LINK', 'REST_AREA', 'BUILDING_GROUP')
    ),
    CONSTRAINT ck_road_node_data_confidence CHECK (data_confidence BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS gist_road_node_geom ON road_node USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_road_node_osm_node_ref ON road_node(osm_node_ref);

CREATE TABLE IF NOT EXISTS road_segment (
    id BIGSERIAL PRIMARY KEY,
    pilot_area_id BIGINT,
    segment_code VARCHAR(50) NOT NULL,
    start_node_id BIGINT NOT NULL,
    end_node_id BIGINT NOT NULL,
    name VARCHAR(100),
    geom GEOMETRY(LineString, 4326) NOT NULL,
    length_m NUMERIC(10,2) NOT NULL,
    slope_percent NUMERIC(5,2) DEFAULT 0,
    surface_type VARCHAR(30) NOT NULL DEFAULT 'CONCRETE',
    width_m NUMERIC(5,2) NOT NULL DEFAULT 1.50,
    surface_level SMALLINT NOT NULL DEFAULT 3,
    safety_level SMALLINT NOT NULL DEFAULT 3,
    barrier_free_level SMALLINT NOT NULL DEFAULT 3,
    rest_facility_score SMALLINT NOT NULL DEFAULT 3,
    lighting_level SMALLINT NOT NULL DEFAULT 3,
    crossing_safety_level SMALLINT NOT NULL DEFAULT 3,
    wheelchair_accessible BOOLEAN NOT NULL DEFAULT FALSE,
    has_handrail BOOLEAN NOT NULL DEFAULT FALSE,
    has_ramp BOOLEAN NOT NULL DEFAULT FALSE,
    shade_coverage_percent SMALLINT NOT NULL DEFAULT 0,
    bench_count INTEGER NOT NULL DEFAULT 0,
    step_count INTEGER NOT NULL DEFAULT 0,
    step_height_cm NUMERIC(5,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    data_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    source_provider VARCHAR(30) NOT NULL DEFAULT 'manual_photo',
    source_coord_type VARCHAR(30) NOT NULL DEFAULT 'wgs84',
    source_ref VARCHAR(255),
    evidence_photo_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_confidence SMALLINT NOT NULL DEFAULT 3,
    last_verified_at TIMESTAMPTZ,
    verified_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_road_segment_segment_code UNIQUE (segment_code),
    CONSTRAINT fk_road_segment_start_node_id FOREIGN KEY (start_node_id) REFERENCES road_node(id),
    CONSTRAINT fk_road_segment_end_node_id FOREIGN KEY (end_node_id) REFERENCES road_node(id),
    CONSTRAINT ck_road_segment_length_m CHECK (length_m >= 0),
    CONSTRAINT ck_road_segment_slope_percent CHECK (slope_percent >= 0),
    CONSTRAINT ck_road_segment_surface_type CHECK (
        surface_type IN ('ASPHALT', 'CONCRETE', 'BRICK', 'GRAVEL', 'GRASS', 'WOOD', 'TILE', 'COBBLESTONE')
    ),
    CONSTRAINT ck_road_segment_width_m CHECK (width_m >= 0),
    CONSTRAINT ck_road_segment_surface_level CHECK (surface_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_safety_level CHECK (safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_barrier_free_level CHECK (barrier_free_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_rest_facility_score CHECK (rest_facility_score BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_lighting_level CHECK (lighting_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_crossing_safety_level CHECK (crossing_safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_shade_coverage_percent CHECK (shade_coverage_percent BETWEEN 0 AND 100),
    CONSTRAINT ck_road_segment_bench_count CHECK (bench_count >= 0),
    CONSTRAINT ck_road_segment_step_count CHECK (step_count >= 0),
    CONSTRAINT ck_road_segment_step_height_cm CHECK (step_height_cm >= 0),
    CONSTRAINT ck_road_segment_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_road_segment_data_source CHECK (data_source IN ('OSM', 'DEM', 'MANUAL', 'OSM_DEM_MANUAL')),
    CONSTRAINT ck_road_segment_data_confidence CHECK (data_confidence BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_not_self_loop CHECK (start_node_id <> end_node_id)
);

CREATE INDEX IF NOT EXISTS idx_road_segment_start_node_id ON road_segment(start_node_id);
CREATE INDEX IF NOT EXISTS idx_road_segment_end_node_id ON road_segment(end_node_id);
CREATE INDEX IF NOT EXISTS gist_road_segment_geom ON road_segment USING GIST (geom);

ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS surface_type VARCHAR(30) NOT NULL DEFAULT 'CONCRETE';
ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS pilot_area_id BIGINT;
ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS linked_node_code VARCHAR(50);
ALTER TABLE road_node ADD COLUMN IF NOT EXISTS pilot_area_id BIGINT;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS pilot_area_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_poi_facility_pilot_area_id ON poi_facility(pilot_area_id);
CREATE INDEX IF NOT EXISTS idx_poi_facility_linked_node_code ON poi_facility(linked_node_code);
CREATE UNIQUE INDEX IF NOT EXISTS uk_poi_facility_area_name_type
    ON poi_facility(pilot_area_id, name, poi_type);
CREATE INDEX IF NOT EXISTS idx_road_node_pilot_area_id ON road_node(pilot_area_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_road_node_area_osm_node_ref
    ON road_node(pilot_area_id, osm_node_ref);
CREATE INDEX IF NOT EXISTS idx_road_segment_pilot_area_id ON road_segment(pilot_area_id);
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS width_m NUMERIC(5,2) NOT NULL DEFAULT 1.50;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS has_handrail BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS has_ramp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS shade_coverage_percent SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS bench_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS step_height_cm NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS source_provider VARCHAR(30) NOT NULL DEFAULT 'manual_photo';
ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS source_coord_type VARCHAR(30) NOT NULL DEFAULT 'wgs84';
ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS source_ref VARCHAR(255);
ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS evidence_photo_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE poi_facility ADD COLUMN IF NOT EXISTS data_confidence SMALLINT NOT NULL DEFAULT 3;
ALTER TABLE road_node ADD COLUMN IF NOT EXISTS source_provider VARCHAR(30) NOT NULL DEFAULT 'manual_photo';
ALTER TABLE road_node ADD COLUMN IF NOT EXISTS source_coord_type VARCHAR(30) NOT NULL DEFAULT 'wgs84';
ALTER TABLE road_node ADD COLUMN IF NOT EXISTS source_ref VARCHAR(255);
ALTER TABLE road_node ADD COLUMN IF NOT EXISTS data_confidence SMALLINT NOT NULL DEFAULT 3;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS source_provider VARCHAR(30) NOT NULL DEFAULT 'manual_photo';
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS source_coord_type VARCHAR(30) NOT NULL DEFAULT 'wgs84';
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS source_ref VARCHAR(255);
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS evidence_photo_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS data_confidence SMALLINT NOT NULL DEFAULT 3;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS verified_by VARCHAR(100);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_poi_facility_pilot_area_id') THEN
        ALTER TABLE poi_facility ADD CONSTRAINT fk_poi_facility_pilot_area_id
            FOREIGN KEY (pilot_area_id) REFERENCES pilot_area(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_road_node_pilot_area_id') THEN
        ALTER TABLE road_node ADD CONSTRAINT fk_road_node_pilot_area_id
            FOREIGN KEY (pilot_area_id) REFERENCES pilot_area(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_road_segment_pilot_area_id') THEN
        ALTER TABLE road_segment ADD CONSTRAINT fk_road_segment_pilot_area_id
            FOREIGN KEY (pilot_area_id) REFERENCES pilot_area(id);
    END IF;
END $$;

ALTER TABLE poi_facility DROP CONSTRAINT IF EXISTS ck_poi_facility_poi_type;
ALTER TABLE poi_facility ADD CONSTRAINT ck_poi_facility_poi_type CHECK (
    poi_type IN (
        'GATE', 'CLINIC', 'CANTEEN', 'BUS_STOP', 'REST_SEAT', 'TOILET', 'RAMP',
        'ENTRANCE', 'BUILDING_GROUP', 'REST_AREA', 'SERVICE_ACCESS', 'WAYPOINT'
    )
);

ALTER TABLE road_node DROP CONSTRAINT IF EXISTS ck_road_node_node_type;
ALTER TABLE road_node ADD CONSTRAINT ck_road_node_node_type CHECK (
    node_type IN ('NORMAL', 'GATE', 'CROSSING', 'POI_LINK', 'REST_AREA', 'BUILDING_GROUP')
);

-- =========================
-- 3. 数据采集与审核
-- =========================

CREATE TABLE IF NOT EXISTS segment_collect_record (
    id BIGSERIAL PRIMARY KEY,
    road_segment_id BIGINT NOT NULL,
    collector_user_id BIGINT NOT NULL,
    surface_level SMALLINT NOT NULL,
    surface_type VARCHAR(30) NOT NULL DEFAULT 'CONCRETE',
    width_m NUMERIC(5,2) NOT NULL DEFAULT 1.50,
    safety_level SMALLINT NOT NULL,
    barrier_free_level SMALLINT NOT NULL,
    rest_facility_score SMALLINT NOT NULL,
    lighting_level SMALLINT NOT NULL,
    crossing_safety_level SMALLINT NOT NULL,
    wheelchair_accessible BOOLEAN NOT NULL DEFAULT FALSE,
    has_handrail BOOLEAN NOT NULL DEFAULT FALSE,
    has_ramp BOOLEAN NOT NULL DEFAULT FALSE,
    shade_coverage_percent SMALLINT NOT NULL DEFAULT 0,
    bench_count INTEGER NOT NULL DEFAULT 0,
    step_count INTEGER NOT NULL DEFAULT 0,
    step_height_cm NUMERIC(5,2) NOT NULL DEFAULT 0,
    remark VARCHAR(500),
    photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    collect_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_segment_collect_record_road_segment_id FOREIGN KEY (road_segment_id) REFERENCES road_segment(id),
    CONSTRAINT fk_segment_collect_record_collector_user_id FOREIGN KEY (collector_user_id) REFERENCES app_user(id),
    CONSTRAINT ck_segment_collect_record_surface_level CHECK (surface_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_width_m CHECK (width_m >= 0),
    CONSTRAINT ck_segment_collect_record_safety_level CHECK (safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_barrier_free_level CHECK (barrier_free_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_rest_facility_score CHECK (rest_facility_score BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_lighting_level CHECK (lighting_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_crossing_safety_level CHECK (crossing_safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_shade_coverage_percent CHECK (shade_coverage_percent BETWEEN 0 AND 100),
    CONSTRAINT ck_segment_collect_record_bench_count CHECK (bench_count >= 0),
    CONSTRAINT ck_segment_collect_record_step_count CHECK (step_count >= 0),
    CONSTRAINT ck_segment_collect_record_step_height_cm CHECK (step_height_cm >= 0),
    CONSTRAINT ck_segment_collect_record_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_segment_collect_record_road_segment_id
    ON segment_collect_record(road_segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_collect_record_collector_user_id
    ON segment_collect_record(collector_user_id);

ALTER TABLE segment_collect_record ADD COLUMN IF NOT EXISTS surface_type VARCHAR(30) NOT NULL DEFAULT 'CONCRETE';
ALTER TABLE segment_collect_record ADD COLUMN IF NOT EXISTS width_m NUMERIC(5,2) NOT NULL DEFAULT 1.50;
ALTER TABLE segment_collect_record ADD COLUMN IF NOT EXISTS has_handrail BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE segment_collect_record ADD COLUMN IF NOT EXISTS has_ramp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE segment_collect_record ADD COLUMN IF NOT EXISTS shade_coverage_percent SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE segment_collect_record ADD COLUMN IF NOT EXISTS bench_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE segment_collect_record ADD COLUMN IF NOT EXISTS step_height_cm NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS segment_audit_record (
    id BIGSERIAL PRIMARY KEY,
    road_segment_id BIGINT NOT NULL,
    collect_record_id BIGINT NOT NULL,
    auditor_user_id BIGINT NOT NULL,
    audit_result VARCHAR(20) NOT NULL,
    audit_comment VARCHAR(500),
    before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_segment_audit_record_road_segment_id FOREIGN KEY (road_segment_id) REFERENCES road_segment(id),
    CONSTRAINT fk_segment_audit_record_collect_record_id FOREIGN KEY (collect_record_id) REFERENCES segment_collect_record(id),
    CONSTRAINT fk_segment_audit_record_auditor_user_id FOREIGN KEY (auditor_user_id) REFERENCES app_user(id),
    CONSTRAINT ck_segment_audit_record_audit_result CHECK (
        audit_result IN ('APPROVED', 'REJECTED', 'UPDATED')
    )
);

CREATE INDEX IF NOT EXISTS idx_segment_audit_record_road_segment_id
    ON segment_audit_record(road_segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_audit_record_collect_record_id
    ON segment_audit_record(collect_record_id);

-- =========================
-- 4. 路线与导航
-- =========================

CREATE TABLE IF NOT EXISTS route_plan_record (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    start_poi_id BIGINT,
    end_poi_id BIGINT,
    start_point GEOMETRY(Point, 4326),
    end_point GEOMETRY(Point, 4326),
    route_rank SMALLINT NOT NULL,
    route_score NUMERIC(10,2) NOT NULL,
    distance_m NUMERIC(10,2) NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    segment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    route_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    selected_by_user BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_route_plan_record_user_id FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT fk_route_plan_record_start_poi_id FOREIGN KEY (start_poi_id) REFERENCES poi_facility(id),
    CONSTRAINT fk_route_plan_record_end_poi_id FOREIGN KEY (end_poi_id) REFERENCES poi_facility(id),
    CONSTRAINT ck_route_plan_record_route_rank CHECK (route_rank BETWEEN 1 AND 3),
    CONSTRAINT ck_route_plan_record_route_score CHECK (route_score >= 0),
    CONSTRAINT ck_route_plan_record_distance_m CHECK (distance_m >= 0),
    CONSTRAINT ck_route_plan_record_estimated_minutes CHECK (estimated_minutes >= 0),
    CONSTRAINT ck_route_plan_record_start_end_input CHECK (
        (start_poi_id IS NOT NULL OR start_point IS NOT NULL)
        AND (end_poi_id IS NOT NULL OR end_point IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_route_plan_record_user_id ON route_plan_record(user_id);
CREATE INDEX IF NOT EXISTS idx_route_plan_record_created_at ON route_plan_record(created_at DESC);
CREATE INDEX IF NOT EXISTS gist_route_plan_record_start_point ON route_plan_record USING GIST (start_point);
CREATE INDEX IF NOT EXISTS gist_route_plan_record_end_point ON route_plan_record USING GIST (end_point);

CREATE TABLE IF NOT EXISTS navigation_track (
    id BIGSERIAL PRIMARY KEY,
    route_plan_record_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    track_point GEOMETRY(Point, 4326) NOT NULL,
    sequence_no INTEGER NOT NULL,
    speed_mps NUMERIC(8,2),
    is_off_route BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_navigation_track_route_plan_record_id FOREIGN KEY (route_plan_record_id) REFERENCES route_plan_record(id),
    CONSTRAINT fk_navigation_track_user_id FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT ck_navigation_track_sequence_no CHECK (sequence_no >= 0),
    CONSTRAINT ck_navigation_track_speed_mps CHECK (speed_mps IS NULL OR speed_mps >= 0)
);

CREATE INDEX IF NOT EXISTS idx_navigation_track_route_plan_record_id
    ON navigation_track(route_plan_record_id);
CREATE INDEX IF NOT EXISTS idx_navigation_track_user_id
    ON navigation_track(user_id);
CREATE INDEX IF NOT EXISTS gist_navigation_track_track_point
    ON navigation_track USING GIST (track_point);

-- =========================
-- 5. 安全事件
-- =========================

CREATE TABLE IF NOT EXISTS emergency_event (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    event_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    trigger_point GEOMETRY(Point, 4326),
    related_route_plan_id BIGINT,
    description VARCHAR(500),
    notified_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT fk_emergency_event_user_id FOREIGN KEY (user_id) REFERENCES app_user(id),
    CONSTRAINT fk_emergency_event_related_route_plan_id FOREIGN KEY (related_route_plan_id) REFERENCES route_plan_record(id),
    CONSTRAINT ck_emergency_event_type CHECK (
        event_type IN ('SOS', 'LONG_STOP', 'OFF_ROUTE')
    ),
    CONSTRAINT ck_emergency_event_status CHECK (
        event_status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')
    ),
    CONSTRAINT ck_emergency_event_resolved_at CHECK (
        resolved_at IS NULL OR resolved_at >= created_at
    )
);

CREATE INDEX IF NOT EXISTS idx_emergency_event_user_id ON emergency_event(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_event_event_status ON emergency_event(event_status);
CREATE INDEX IF NOT EXISTS gist_emergency_event_trigger_point
    ON emergency_event USING GIST (trigger_point);

-- =========================
-- 6. 自动更新时间触发器
-- =========================

DROP TRIGGER IF EXISTS trg_app_user_set_updated_at ON app_user;
CREATE TRIGGER trg_app_user_set_updated_at
BEFORE UPDATE ON app_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_elder_profile_set_updated_at ON elder_profile;
CREATE TRIGGER trg_elder_profile_set_updated_at
BEFORE UPDATE ON elder_profile
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_family_binding_set_updated_at ON family_binding;
CREATE TRIGGER trg_family_binding_set_updated_at
BEFORE UPDATE ON family_binding
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_poi_facility_set_updated_at ON poi_facility;
CREATE TRIGGER trg_poi_facility_set_updated_at
BEFORE UPDATE ON poi_facility
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_road_segment_set_updated_at ON road_segment;
CREATE TRIGGER trg_road_segment_set_updated_at
BEFORE UPDATE ON road_segment
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

BEGIN;

UPDATE poi_facility SET status = 'INACTIVE' WHERE name = '重庆师范大学三号门';

UPDATE poi_facility SET status = 'INACTIVE' WHERE name = '重庆师范大学校医院';

UPDATE poi_facility SET status = 'INACTIVE' WHERE name = '重庆师范大学食堂';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_GATE3_TO_CROSS1';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_CROSS1_TO_CLINIC';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_CLINIC_TO_CROSS2';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_CROSS2_TO_CANTEEN';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_GATE3_TO_REST';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_REST_TO_CLINIC';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_GATE3_TO_WIDE_PATH';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_WIDE_PATH_TO_SIDE';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_SIDE_TO_CANTEEN';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_REST_TO_WIDE_PATH';

UPDATE road_segment SET status = 'INACTIVE' WHERE segment_code = 'S_CROSS1_TO_WIDE_PATH';

INSERT INTO pilot_area (
    area_code, name, boundary_geom, center_geom, min_zoom, max_zoom, status
) VALUES (
    'SHIDAYUAN',
    '师大苑',
    ST_SetSRID(ST_GeomFromText('POLYGON((106.2868 29.6132,106.2909 29.6132,106.2909 29.6167,106.2868 29.6167,106.2868 29.6132))'), 4326),
    ST_SetSRID(ST_GeomFromText('POINT(106.28885 29.61495)'), 4326),
    16,
    20,
    'ACTIVE'
)
ON CONFLICT (area_code) DO UPDATE SET
    name = EXCLUDED.name,
    boundary_geom = EXCLUDED.boundary_geom,
    center_geom = EXCLUDED.center_geom,
    min_zoom = EXCLUDED.min_zoom,
    max_zoom = EXCLUDED.max_zoom,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_GATE_WEST',
    '师大苑大学城西路入口节点',
    ST_SetSRID(ST_MakePoint(106.288375, 29.6136694), 4326),
    'GATE',
    'manual_photo',
    'wgs84',
    'IMG_9555.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_COMMERCIAL_SIDEWALK',
    '外部商业街人行道节点',
    ST_SetSRID(ST_MakePoint(106.288125, 29.6134861), 4326),
    'POI_LINK',
    'manual_photo',
    'wgs84',
    'IMG_9553.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_MAIN_CENTER',
    '师大苑内部主路中心节点',
    ST_SetSRID(ST_MakePoint(106.287575, 29.6161361), 4326),
    'CROSSING',
    'manual_photo',
    'wgs84',
    'IMG_9540.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_BUILDING_A',
    '师大苑楼栋组团A节点',
    ST_SetSRID(ST_MakePoint(106.2900778, 29.6145389), 4326),
    'BUILDING_GROUP',
    'manual_photo',
    'wgs84',
    'IMG_9505.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_BUILDING_B',
    '师大苑楼栋组团B节点',
    ST_SetSRID(ST_MakePoint(106.2871389, 29.6151611), 4326),
    'BUILDING_GROUP',
    'manual_photo',
    'wgs84',
    'IMG_9544.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_LOTUS_ENTRY',
    '荷塘水景入口观景节点',
    ST_SetSRID(ST_MakePoint(106.2884917, 29.6144111), 4326),
    'REST_AREA',
    'manual_photo',
    'wgs84',
    'IMG_9550.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_LOTUS_PLATFORM',
    '荷塘平台休息节点',
    ST_SetSRID(ST_MakePoint(106.2884917, 29.6144306), 4326),
    'REST_AREA',
    'manual_photo',
    'wgs84',
    'IMG_9551.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_GARDEN_SPLIT',
    '林下步道分叉节点',
    ST_SetSRID(ST_MakePoint(106.2884444, 29.6163778), 4326),
    'NORMAL',
    'manual_photo',
    'wgs84',
    'IMG_9537.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_GARDEN_REST',
    '林下亭廊休息节点',
    ST_SetSRID(ST_MakePoint(106.2890917, 29.6161611), 4326),
    'REST_AREA',
    'manual_photo',
    'wgs84',
    'IMG_9531.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_POND_BRIDGE',
    '水景桥节点',
    ST_SetSRID(ST_MakePoint(106.2872, 29.6151028), 4326),
    'NORMAL',
    'manual_photo',
    'wgs84',
    'IMG_9546.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_STAIR_SHORTCUT',
    '台阶捷径节点',
    ST_SetSRID(ST_MakePoint(106.2891528, 29.6160472), 4326),
    'NORMAL',
    'manual_photo',
    'wgs84',
    'IMG_9526.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_node (
    pilot_area_id, osm_node_ref, name, geom, node_type,
    source_provider, source_coord_type, source_ref, data_confidence
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'N_SY_CRACK_RISK',
    '路面裂缝风险节点',
    ST_SetSRID(ST_MakePoint(106.28885, 29.6145833), 4326),
    'NORMAL',
    'manual_photo',
    'wgs84',
    'IMG_9511.JPG',
    5
)
ON CONFLICT (pilot_area_id, osm_node_ref) DO UPDATE SET
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    node_type = EXCLUDED.node_type,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    data_confidence = EXCLUDED.data_confidence;

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_GATE_TO_MAIN',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
    '入口到内部主路中心',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER')
    ),
    92.0,
    1.2,
    'ASPHALT',
    3.2,
    4,
    3,
    4,
    3,
    4,
    3,
    TRUE,
    FALSE,
    FALSE,
    80,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9499", "SY_IMG_9500", "SY_IMG_9540"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_MAIN_TO_LOTUS',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY'),
    '内部主路到荷塘观景入口',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY')
    ),
    154.0,
    1.4,
    'ASPHALT',
    3.0,
    4,
    3,
    4,
    4,
    4,
    3,
    TRUE,
    FALSE,
    FALSE,
    85,
    1,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9542", "SY_IMG_9550"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_LOTUS_ENTRY_TO_PLATFORM',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_PLATFORM'),
    '荷塘入口到平台座椅',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_PLATFORM')
    ),
    72.0,
    1.0,
    'BRICK',
    1.4,
    3,
    3,
    2,
    5,
    3,
    4,
    FALSE,
    FALSE,
    FALSE,
    80,
    3,
    1,
    12,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9551", "SY_IMG_9548"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_MAIN_TO_BUILDING_A',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_A'),
    '内部主路到楼栋组团A',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_A')
    ),
    78.0,
    1.6,
    'ASPHALT',
    2.8,
    4,
    3,
    4,
    3,
    4,
    3,
    TRUE,
    FALSE,
    FALSE,
    75,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9505", "SY_IMG_9544"]'::jsonb,
    3,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_BUILDING_A_TO_LOTUS',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_A'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY'),
    '楼栋组团A到荷塘观景入口',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_A'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY')
    ),
    108.0,
    1.3,
    'ASPHALT',
    2.6,
    4,
    3,
    4,
    4,
    4,
    3,
    TRUE,
    FALSE,
    FALSE,
    80,
    1,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9542", "SY_IMG_9544"]'::jsonb,
    3,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_MAIN_TO_BUILDING_B',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_B'),
    '内部主路到楼栋组团B',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_B')
    ),
    94.0,
    1.7,
    'ASPHALT',
    2.5,
    4,
    3,
    4,
    3,
    4,
    3,
    TRUE,
    FALSE,
    FALSE,
    75,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9540", "SY_IMG_9544"]'::jsonb,
    3,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_BUILDING_B_TO_LOTUS',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_B'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY'),
    '楼栋组团B到荷塘观景入口',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_B'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY')
    ),
    98.0,
    1.5,
    'ASPHALT',
    2.4,
    4,
    3,
    4,
    4,
    4,
    3,
    TRUE,
    FALSE,
    FALSE,
    80,
    1,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9550"]'::jsonb,
    3,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_GATE_TO_COMMERCIAL',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_COMMERCIAL_SIDEWALK'),
    '入口到外部商业街人行道',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_COMMERCIAL_SIDEWALK')
    ),
    58.0,
    1.0,
    'BRICK',
    2.2,
    4,
    2,
    4,
    2,
    4,
    2,
    TRUE,
    FALSE,
    TRUE,
    40,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9555", "SY_IMG_9553"]'::jsonb,
    3,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_COMMERCIAL_TO_MAIN',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_COMMERCIAL_SIDEWALK'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
    '外部商业街绕行到内部主路',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_COMMERCIAL_SIDEWALK'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER')
    ),
    138.0,
    1.2,
    'BRICK',
    2.0,
    4,
    2,
    4,
    2,
    4,
    2,
    TRUE,
    FALSE,
    TRUE,
    35,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9555"]'::jsonb,
    2,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_GATE_TO_GARDEN_SPLIT',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_SPLIT'),
    '入口到林下步道分叉',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_SPLIT')
    ),
    184.0,
    2.2,
    'BRICK',
    1.2,
    3,
    4,
    3,
    4,
    3,
    4,
    FALSE,
    FALSE,
    FALSE,
    90,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9509", "SY_IMG_9537"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_GARDEN_SPLIT_TO_REST',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_SPLIT'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_REST'),
    '林下步道到亭廊休息点',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_SPLIT'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_REST')
    ),
    86.0,
    2.5,
    'BRICK',
    1.1,
    3,
    4,
    3,
    5,
    3,
    4,
    FALSE,
    FALSE,
    FALSE,
    90,
    2,
    1,
    10,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9531", "SY_IMG_9536", "SY_IMG_9537"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_GARDEN_REST_TO_BRIDGE',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_REST'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_POND_BRIDGE'),
    '亭廊休息点到水景桥',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_REST'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_POND_BRIDGE')
    ),
    78.0,
    2.0,
    'WOOD',
    1.3,
    3,
    3,
    3,
    5,
    3,
    4,
    FALSE,
    TRUE,
    FALSE,
    85,
    1,
    1,
    10,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9515", "SY_IMG_9524", "SY_IMG_9546"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_BRIDGE_TO_LOTUS',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_POND_BRIDGE'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY'),
    '水景桥到荷塘观景入口',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_POND_BRIDGE'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY')
    ),
    96.0,
    1.8,
    'BRICK',
    1.2,
    3,
    3,
    3,
    4,
    3,
    4,
    FALSE,
    TRUE,
    FALSE,
    80,
    0,
    1,
    10,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9529", "SY_IMG_9533"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_STAIR_SHORTCUT',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_REST'),
    '内部主路到亭廊台阶捷径',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_MAIN_CENTER'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_REST')
    ),
    168.0,
    3.2,
    'BRICK',
    1.0,
    3,
    3,
    1,
    4,
    3,
    4,
    FALSE,
    FALSE,
    FALSE,
    85,
    1,
    3,
    13,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9523", "SY_IMG_9526", "SY_IMG_9528", "SY_IMG_9539"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_STEPPING_STONE_SHORTCUT',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_SPLIT'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_STAIR_SHORTCUT'),
    '林下汀步捷径',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_SPLIT'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_STAIR_SHORTCUT')
    ),
    62.0,
    2.0,
    'COBBLESTONE',
    0.8,
    2,
    3,
    1,
    4,
    3,
    4,
    FALSE,
    FALSE,
    FALSE,
    90,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9508"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_CRACKED_PAVEMENT',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_CRACK_RISK'),
    '入口旁路面裂缝风险段',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_CRACK_RISK')
    ),
    58.0,
    1.0,
    'BRICK',
    1.3,
    2,
    3,
    2,
    2,
    3,
    3,
    FALSE,
    FALSE,
    FALSE,
    40,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9511"]'::jsonb,
    4,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO road_segment (
    pilot_area_id, segment_code, start_node_id, end_node_id, name, geom,
    length_m, slope_percent, surface_type, width_m, surface_level,
    safety_level, barrier_free_level, rest_facility_score, lighting_level,
    crossing_safety_level, wheelchair_accessible, has_handrail, has_ramp,
    shade_coverage_percent, bench_count, step_count, step_height_cm,
    data_source, source_provider, source_coord_type, source_ref,
    evidence_photo_refs, data_confidence, verified_by, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    'S_SY_CRACK_TO_BUILDING_B',
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_CRACK_RISK'),
    (SELECT rn.id FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_B'),
    '裂缝风险段到楼栋组团B',
    ST_MakeLine(
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_CRACK_RISK'),
        (SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_B')
    ),
    108.0,
    1.5,
    'BRICK',
    1.4,
    3,
    3,
    3,
    3,
    3,
    3,
    FALSE,
    FALSE,
    FALSE,
    70,
    0,
    0,
    0,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'docs/data-collection/shidayuan_photo_segment_mapping_draft.md',
    '["SY_IMG_9511", "SY_IMG_9548"]'::jsonb,
    3,
    NULL,
    'ACTIVE'
)
ON CONFLICT (segment_code) DO UPDATE SET
    pilot_area_id = EXCLUDED.pilot_area_id,
    start_node_id = EXCLUDED.start_node_id,
    end_node_id = EXCLUDED.end_node_id,
    name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    length_m = EXCLUDED.length_m,
    slope_percent = EXCLUDED.slope_percent,
    surface_type = EXCLUDED.surface_type,
    width_m = EXCLUDED.width_m,
    surface_level = EXCLUDED.surface_level,
    safety_level = EXCLUDED.safety_level,
    barrier_free_level = EXCLUDED.barrier_free_level,
    rest_facility_score = EXCLUDED.rest_facility_score,
    lighting_level = EXCLUDED.lighting_level,
    crossing_safety_level = EXCLUDED.crossing_safety_level,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    has_handrail = EXCLUDED.has_handrail,
    has_ramp = EXCLUDED.has_ramp,
    shade_coverage_percent = EXCLUDED.shade_coverage_percent,
    bench_count = EXCLUDED.bench_count,
    step_count = EXCLUDED.step_count,
    step_height_cm = EXCLUDED.step_height_cm,
    data_source = EXCLUDED.data_source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    verified_by = EXCLUDED.verified_by,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO poi_facility (
    pilot_area_id, name, poi_type, description, geom, address_text,
    linked_node_code, is_accessible, source, source_provider, source_coord_type,
    source_ref, evidence_photo_refs, data_confidence, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    '师大苑大学城西路入口',
    'ENTRANCE',
    '师大苑试点入口，连接外部大学城西路和小区内部主路。',
    COALESCE((SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GATE_WEST'), ST_SetSRID(ST_MakePoint(106.306, 29.6038), 4326)),
    NULL,
    'N_SY_GATE_WEST',
    TRUE,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'IMG_9555.JPG',
    '["SY_IMG_9555", "SY_IMG_9553"]'::jsonb,
    3,
    'ACTIVE'
)
ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET
    description = EXCLUDED.description,
    geom = EXCLUDED.geom,
    address_text = EXCLUDED.address_text,
    linked_node_code = EXCLUDED.linked_node_code,
    is_accessible = EXCLUDED.is_accessible,
    source = EXCLUDED.source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO poi_facility (
    pilot_area_id, name, poi_type, description, geom, address_text,
    linked_node_code, is_accessible, source, source_provider, source_coord_type,
    source_ref, evidence_photo_refs, data_confidence, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    '师大苑荷塘水景休息区',
    'REST_AREA',
    '荷塘旁观景与休息区域，树荫和座椅条件较好，平台边缘需注意高差。',
    COALESCE((SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_LOTUS_ENTRY'), ST_SetSRID(ST_MakePoint(106.3084, 29.6041), 4326)),
    NULL,
    'N_SY_LOTUS_ENTRY',
    TRUE,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'IMG_9550.JPG',
    '["SY_IMG_9550", "SY_IMG_9551"]'::jsonb,
    4,
    'ACTIVE'
)
ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET
    description = EXCLUDED.description,
    geom = EXCLUDED.geom,
    address_text = EXCLUDED.address_text,
    linked_node_code = EXCLUDED.linked_node_code,
    is_accessible = EXCLUDED.is_accessible,
    source = EXCLUDED.source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO poi_facility (
    pilot_area_id, name, poi_type, description, geom, address_text,
    linked_node_code, is_accessible, source, source_provider, source_coord_type,
    source_ref, evidence_photo_refs, data_confidence, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    '师大苑楼栋组团A',
    'BUILDING_GROUP',
    '地图截图中 48-51 栋附近的第一版楼栋组团。',
    COALESCE((SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_A'), ST_SetSRID(ST_MakePoint(106.3074, 29.6045), 4326)),
    NULL,
    'N_SY_BUILDING_A',
    TRUE,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'IMG_9510.PNG',
    '["SY_IMG_9510", "SY_IMG_9505"]'::jsonb,
    3,
    'ACTIVE'
)
ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET
    description = EXCLUDED.description,
    geom = EXCLUDED.geom,
    address_text = EXCLUDED.address_text,
    linked_node_code = EXCLUDED.linked_node_code,
    is_accessible = EXCLUDED.is_accessible,
    source = EXCLUDED.source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO poi_facility (
    pilot_area_id, name, poi_type, description, geom, address_text,
    linked_node_code, is_accessible, source, source_provider, source_coord_type,
    source_ref, evidence_photo_refs, data_confidence, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    '师大苑楼栋组团B',
    'BUILDING_GROUP',
    '地图截图中 54-56 栋附近的第一版楼栋组团。',
    COALESCE((SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_BUILDING_B'), ST_SetSRID(ST_MakePoint(106.3076, 29.6037), 4326)),
    NULL,
    'N_SY_BUILDING_B',
    TRUE,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'IMG_9535.PNG',
    '["SY_IMG_9535", "SY_IMG_9544"]'::jsonb,
    3,
    'ACTIVE'
)
ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET
    description = EXCLUDED.description,
    geom = EXCLUDED.geom,
    address_text = EXCLUDED.address_text,
    linked_node_code = EXCLUDED.linked_node_code,
    is_accessible = EXCLUDED.is_accessible,
    source = EXCLUDED.source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO poi_facility (
    pilot_area_id, name, poi_type, description, geom, address_text,
    linked_node_code, is_accessible, source, source_provider, source_coord_type,
    source_ref, evidence_photo_refs, data_confidence, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    '师大苑林下休闲步道',
    'REST_AREA',
    '树荫较好、环境舒适的林下步道，但存在窄路、台阶和边缘高差。',
    COALESCE((SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_GARDEN_REST'), ST_SetSRID(ST_MakePoint(106.3086, 29.60315), 4326)),
    NULL,
    'N_SY_GARDEN_REST',
    FALSE,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'IMG_9537.JPG',
    '["SY_IMG_9509", "SY_IMG_9537", "SY_IMG_9539"]'::jsonb,
    4,
    'ACTIVE'
)
ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET
    description = EXCLUDED.description,
    geom = EXCLUDED.geom,
    address_text = EXCLUDED.address_text,
    linked_node_code = EXCLUDED.linked_node_code,
    is_accessible = EXCLUDED.is_accessible,
    source = EXCLUDED.source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO poi_facility (
    pilot_area_id, name, poi_type, description, geom, address_text,
    linked_node_code, is_accessible, source, source_provider, source_coord_type,
    source_ref, evidence_photo_refs, data_confidence, status
) VALUES (
    (SELECT id FROM pilot_area WHERE area_code = 'SHIDAYUAN'),
    '师大苑外部商业街人行道',
    'SERVICE_ACCESS',
    '小区外部生活服务方向，人行道较宽但车流和围挡需要注意。',
    COALESCE((SELECT rn.geom FROM road_node rn JOIN pilot_area pa ON pa.id = rn.pilot_area_id WHERE pa.area_code = 'SHIDAYUAN' AND rn.osm_node_ref = 'N_SY_COMMERCIAL_SIDEWALK'), ST_SetSRID(ST_MakePoint(106.3056, 29.6035), 4326)),
    NULL,
    'N_SY_COMMERCIAL_SIDEWALK',
    TRUE,
    'MANUAL',
    'manual_photo',
    'wgs84',
    'IMG_9555.JPG',
    '["SY_IMG_9555"]'::jsonb,
    3,
    'ACTIVE'
)
ON CONFLICT (pilot_area_id, name, poi_type) DO UPDATE SET
    description = EXCLUDED.description,
    geom = EXCLUDED.geom,
    address_text = EXCLUDED.address_text,
    linked_node_code = EXCLUDED.linked_node_code,
    is_accessible = EXCLUDED.is_accessible,
    source = EXCLUDED.source,
    source_provider = EXCLUDED.source_provider,
    source_coord_type = EXCLUDED.source_coord_type,
    source_ref = EXCLUDED.source_ref,
    evidence_photo_refs = EXCLUDED.evidence_photo_refs,
    data_confidence = EXCLUDED.data_confidence,
    status = EXCLUDED.status,
    updated_at = NOW();

DO $$
DECLARE
    endpoint_count INTEGER;
    invalid_link_count INTEGER;
    cross_area_segment_node_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_link_count
    FROM poi_facility pf
    JOIN pilot_area pa ON pa.id = pf.pilot_area_id
    LEFT JOIN road_node rn
      ON rn.pilot_area_id = pf.pilot_area_id
     AND rn.osm_node_ref = pf.linked_node_code
    WHERE pa.area_code = 'SHIDAYUAN'
      AND pf.status = 'ACTIVE'
      AND pf.linked_node_code IS NOT NULL
      AND rn.id IS NULL;

    IF invalid_link_count > 0 THEN
        RAISE EXCEPTION 'Route endpoint validation failed: % invalid linked nodes', invalid_link_count;
    END IF;

    SELECT COUNT(*) INTO cross_area_segment_node_count
    FROM road_segment rs
    JOIN pilot_area pa ON pa.id = rs.pilot_area_id
    JOIN road_node start_node ON start_node.id = rs.start_node_id
    JOIN road_node end_node ON end_node.id = rs.end_node_id
    WHERE pa.area_code = 'SHIDAYUAN'
      AND rs.status = 'ACTIVE'
      AND (
          start_node.pilot_area_id <> rs.pilot_area_id
          OR end_node.pilot_area_id <> rs.pilot_area_id
      );

    IF cross_area_segment_node_count > 0 THEN
        RAISE EXCEPTION 'Route endpoint validation failed: % cross-area segment nodes',
            cross_area_segment_node_count;
    END IF;

    SELECT COUNT(*) INTO endpoint_count
    FROM poi_facility pf
    JOIN pilot_area pa ON pa.id = pf.pilot_area_id
    JOIN road_node rn
      ON rn.pilot_area_id = pf.pilot_area_id
     AND rn.osm_node_ref = pf.linked_node_code
    WHERE pa.area_code = 'SHIDAYUAN'
      AND pa.status = 'ACTIVE'
      AND pf.status = 'ACTIVE';

    IF endpoint_count < 6 THEN
        RAISE EXCEPTION 'Route endpoint validation failed: expected at least %, got %',
            6, endpoint_count;
    END IF;
END $$;

COMMIT;

