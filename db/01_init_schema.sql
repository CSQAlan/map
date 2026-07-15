-- 助老地图 MVP 初始化数据库脚本
-- 试点范围：重庆师范大学三号门 / 校医院 / 食堂
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
    CONSTRAINT ck_app_user_role CHECK (role IN ('ELDER', 'FAMILY', 'ADMIN')),
    CONSTRAINT ck_app_user_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

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

CREATE TABLE IF NOT EXISTS poi_facility (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    poi_type VARCHAR(30) NOT NULL,
    description VARCHAR(255),
    geom GEOMETRY(Point, 4326) NOT NULL,
    address_text VARCHAR(255),
    is_accessible BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_poi_facility_poi_type CHECK (
        poi_type IN ('GATE', 'CLINIC', 'CANTEEN', 'BUS_STOP', 'REST_SEAT', 'TOILET', 'RAMP')
    ),
    CONSTRAINT ck_poi_facility_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_poi_facility_source CHECK (source IN ('OSM', 'MANUAL', 'DERIVED'))
);

CREATE INDEX IF NOT EXISTS gist_poi_facility_geom ON poi_facility USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_poi_facility_poi_type ON poi_facility(poi_type);

CREATE TABLE IF NOT EXISTS road_node (
    id BIGSERIAL PRIMARY KEY,
    osm_node_ref VARCHAR(50),
    name VARCHAR(100),
    geom GEOMETRY(Point, 4326) NOT NULL,
    node_type VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_road_node_node_type CHECK (
        node_type IN ('NORMAL', 'GATE', 'CROSSING', 'POI_LINK')
    )
);

CREATE INDEX IF NOT EXISTS gist_road_node_geom ON road_node USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_road_node_osm_node_ref ON road_node(osm_node_ref);

CREATE TABLE IF NOT EXISTS road_segment (
    id BIGSERIAL PRIMARY KEY,
    segment_code VARCHAR(50) NOT NULL,
    start_node_id BIGINT NOT NULL,
    end_node_id BIGINT NOT NULL,
    name VARCHAR(100),
    geom GEOMETRY(LineString, 4326) NOT NULL,
    length_m NUMERIC(10,2) NOT NULL,
    slope_percent NUMERIC(5,2) DEFAULT 0,
    surface_level SMALLINT NOT NULL DEFAULT 3,
    safety_level SMALLINT NOT NULL DEFAULT 3,
    barrier_free_level SMALLINT NOT NULL DEFAULT 3,
    rest_facility_score SMALLINT NOT NULL DEFAULT 3,
    lighting_level SMALLINT NOT NULL DEFAULT 3,
    crossing_safety_level SMALLINT NOT NULL DEFAULT 3,
    wheelchair_accessible BOOLEAN NOT NULL DEFAULT FALSE,
    step_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    data_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_road_segment_segment_code UNIQUE (segment_code),
    CONSTRAINT fk_road_segment_start_node_id FOREIGN KEY (start_node_id) REFERENCES road_node(id),
    CONSTRAINT fk_road_segment_end_node_id FOREIGN KEY (end_node_id) REFERENCES road_node(id),
    CONSTRAINT ck_road_segment_length_m CHECK (length_m >= 0),
    CONSTRAINT ck_road_segment_slope_percent CHECK (slope_percent >= 0),
    CONSTRAINT ck_road_segment_surface_level CHECK (surface_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_safety_level CHECK (safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_barrier_free_level CHECK (barrier_free_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_rest_facility_score CHECK (rest_facility_score BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_lighting_level CHECK (lighting_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_crossing_safety_level CHECK (crossing_safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_road_segment_step_count CHECK (step_count >= 0),
    CONSTRAINT ck_road_segment_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_road_segment_data_source CHECK (data_source IN ('OSM', 'DEM', 'MANUAL', 'OSM_DEM_MANUAL')),
    CONSTRAINT ck_road_segment_not_self_loop CHECK (start_node_id <> end_node_id)
);

CREATE INDEX IF NOT EXISTS idx_road_segment_start_node_id ON road_segment(start_node_id);
CREATE INDEX IF NOT EXISTS idx_road_segment_end_node_id ON road_segment(end_node_id);
CREATE INDEX IF NOT EXISTS gist_road_segment_geom ON road_segment USING GIST (geom);

-- =========================
-- 3. 数据采集与审核
-- =========================

CREATE TABLE IF NOT EXISTS segment_collect_record (
    id BIGSERIAL PRIMARY KEY,
    road_segment_id BIGINT NOT NULL,
    collector_user_id BIGINT NOT NULL,
    surface_level SMALLINT NOT NULL,
    safety_level SMALLINT NOT NULL,
    barrier_free_level SMALLINT NOT NULL,
    rest_facility_score SMALLINT NOT NULL,
    lighting_level SMALLINT NOT NULL,
    crossing_safety_level SMALLINT NOT NULL,
    wheelchair_accessible BOOLEAN NOT NULL DEFAULT FALSE,
    step_count INTEGER NOT NULL DEFAULT 0,
    remark VARCHAR(500),
    photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    collect_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_segment_collect_record_road_segment_id FOREIGN KEY (road_segment_id) REFERENCES road_segment(id),
    CONSTRAINT fk_segment_collect_record_collector_user_id FOREIGN KEY (collector_user_id) REFERENCES app_user(id),
    CONSTRAINT ck_segment_collect_record_surface_level CHECK (surface_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_safety_level CHECK (safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_barrier_free_level CHECK (barrier_free_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_rest_facility_score CHECK (rest_facility_score BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_lighting_level CHECK (lighting_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_crossing_safety_level CHECK (crossing_safety_level BETWEEN 1 AND 5),
    CONSTRAINT ck_segment_collect_record_step_count CHECK (step_count >= 0),
    CONSTRAINT ck_segment_collect_record_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_segment_collect_record_road_segment_id
    ON segment_collect_record(road_segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_collect_record_collector_user_id
    ON segment_collect_record(collector_user_id);

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

