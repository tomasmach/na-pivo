from django.conf import settings
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.csrf import csrf_failure as django_csrf_failure


def csrf_failure(request: HttpRequest, reason: str = "") -> HttpResponse:
    """A login form sent twice fails CSRF, since login rotates the token; the first one already signed the person in."""

    user = getattr(request, "user", None)
    signed_in = settings.ENABLE_DJANGO_ADMIN and request.method == "POST" and user is not None and user.is_staff
    if signed_in and request.path == reverse("admin:login"):
        next_url = request.POST.get("next") or request.GET.get("next", "")
        safe = url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure())
        return HttpResponseRedirect(next_url if safe else reverse("admin:index"))
    return django_csrf_failure(request, reason)
