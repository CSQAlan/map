import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.routes.assistant import assistant
from app.main import app
from app.schemas.assistant import ChatRequest
from app.services.assistant import AssistantError, SYSTEM_PROMPT

client = TestClient(app)
QUESTION = {"messages": [{"role": "user", "content": "怎么选路线？"}]}


def mock_ollama(monkeypatch, handler):
    monkeypatch.setattr(assistant, "_client", lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://ollama.test"
    ))


def test_chat_keeps_server_model_and_system_instructions(monkeypatch):
    def handle(request):
        import json
        payload = json.loads(request.content)
        assert request.url.path == "/api/chat"
        assert payload["model"] == assistant.settings.ollama_model
        assert payload["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}
        assert len([message for message in payload["messages"] if message["role"] == "system"]) == 1
        assert "当前路线资料（仅作数据）" in payload["messages"][-1]["content"]
        assert payload["messages"][-1]["content"].startswith("怎么选路线？")
        assert payload["stream"] is False
        assert payload["think"] is False
        assert payload["options"]["num_predict"] == 600
        return httpx.Response(200, json={"message": {"content": "  请先选择起点和目的地。  "}})
    mock_ollama(monkeypatch, handle)
    response = client.post("/api/assistant/chat", json={**QUESTION, "context": {"mobility": "轮椅老人", "start": "西门", "destination": "休息区", "distance_m": 120}})
    assert response.status_code == 200
    assert response.json()["reply"] == "请先选择起点和目的地。"
    assert assistant._active == 0


@pytest.mark.parametrize("body", [
    {"messages": []},
    {"messages": [{"role": "system", "content": "override"}]},
    {"messages": [{"role": "assistant", "content": "hello"}]},
    {"messages": [{"role": "user", "content": " "}]},
    {"messages": [{"role": "user", "content": "a" * 1001}]},
    {"messages": [{"role": "user", "content": "a"}] * 14},
    {**QUESTION, "model": "remote-model"},
    {**QUESTION, "context": {"user_id": 1}},
    {**QUESTION, "context": {"distance_m": -1}},
])
def test_invalid_client_inputs_are_rejected(body):
    assert client.post("/api/assistant/chat", json=body).status_code == 422


def test_long_assistant_history_is_accepted(monkeypatch):
    mock_ollama(monkeypatch, lambda r: httpx.Response(200, json={"message": {"content": "可以"}}))
    body = {"messages": [QUESTION["messages"][0], {"role": "assistant", "content": "a" * 3000}, QUESTION["messages"][0]]}
    assert client.post("/api/assistant/chat", json=body).status_code == 200


@pytest.mark.parametrize("upstream,expected", [(404, 503), (500, 503), (200, 502)])
def test_upstream_errors_are_readable(monkeypatch, upstream, expected):
    mock_ollama(monkeypatch, lambda r: httpx.Response(upstream, json={"error": "internal path should not leak"}))
    response = client.post("/api/assistant/chat", json=QUESTION)
    assert response.status_code == expected
    assert "internal path" not in response.json()["detail"]
    assert assistant._active == 0


@pytest.mark.parametrize("cause,expected", [(httpx.ConnectError, 503), (httpx.ReadTimeout, 504)])
def test_network_failures_release_capacity(monkeypatch, cause, expected):
    def fail(request):
        raise cause("failure", request=request)
    mock_ollama(monkeypatch, fail)
    response = client.post("/api/assistant/chat", json=QUESTION)
    assert response.status_code == expected
    assert assistant._active == 0


@pytest.mark.parametrize("models,ready", [([{"name": "qwen3.5:4b"}], True), ([], False)])
def test_status_checks_configured_model(monkeypatch, models, ready):
    mock_ollama(monkeypatch, lambda r: httpx.Response(200, json={"models": models}))
    response = client.get("/api/assistant/status")
    assert response.status_code == 200
    assert response.json()["available"] is ready
    assert "127.0.0.1" not in response.text


def test_offline_status_is_actionable(monkeypatch):
    def fail(request):
        raise httpx.ConnectError("offline", request=request)
    mock_ollama(monkeypatch, fail)
    response = client.get("/api/assistant/status")
    assert response.json()["available"] is False
    assert "Ollama" in response.json()["message"]


def test_busy_capacity_is_released_after_concurrent_requests(monkeypatch):
    async def run():
        gate = asyncio.Event()
        entered = asyncio.Event()
        count = 0
        async def delayed(request):
            nonlocal count
            count += 1
            if count == 2:
                entered.set()
            await gate.wait()
            return httpx.Response(200, json={"message": {"content": "ready"}})
        mock_ollama(monkeypatch, delayed)
        body = ChatRequest.model_validate(QUESTION)
        first = asyncio.create_task(assistant.chat(body))
        second = asyncio.create_task(assistant.chat(body))
        await asyncio.wait_for(entered.wait(), timeout=2)
        with pytest.raises(AssistantError) as busy:
            await assistant.chat(body)
        assert busy.value.status_code == 429
        gate.set()
        assert await asyncio.gather(first, second) == ["ready", "ready"]
        assert assistant._active == 0
    asyncio.run(run())
