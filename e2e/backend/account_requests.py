"""Bounded, body-free observations of account writes on the local backend."""

from collections import deque

requests = deque(maxlen=20)
export_requests = deque(maxlen=20)


class AccountWriteObserver:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        observation = None
        if request.path == "/v1/account/me" and request.method in ("DELETE", "PATCH"):
            observation = {"method": request.method, "status": None}
            requests.append(observation)
        elif request.path == "/v1/account/export" and request.method == "POST":
            observation = {"method": "POST", "status": None}
            export_requests.append(observation)
        response = self.get_response(request)
        if observation is not None:
            observation["status"] = response.status_code
        return response
