// In this Emergent deployment the FastAPI backend is managed by supervisor
// (uvicorn on :8001) and the ingress routes /api/* straight to it. So the
// Next server must NOT spawn its own uvicorn (that would race for port 8001).
// register() is intentionally a no-op here.
export async function register() {}
