import base64
import ipaddress
import socket

from django.apps import AppConfig


class LocalFixtures(AppConfig):
    name = "e2e.backend"
    label = "local_e2e_fixtures"

    def ready(self):
        from django.conf import settings
        from django.core.mail import EmailMultiAlternatives

        from pubs import emailer

        if not settings.DEBUG:
            raise RuntimeError("Local fixtures require DEBUG.")

        def capture_email(to, subject, html, *, text=None, attachments=None, **_kwargs):
            message = EmailMultiAlternatives(subject, text or "", to=[to])
            message.attach_alternative(html, "text/html")
            for attachment in attachments or []:
                message.attach(
                    attachment["filename"],
                    base64.b64decode(attachment["content"]),
                    attachment.get("content_type"),
                )
            message.send()
            return True

        emailer.send_email = capture_email

        # Catch every Python network adapter, including unexpected new integrations.
        original_connect = socket.socket.connect

        def local_connect(sock, address):
            if sock.family in (socket.AF_INET, socket.AF_INET6):
                try:
                    local = ipaddress.ip_address(address[0]).is_loopback
                except ValueError:
                    local = address[0] == "localhost"
                if not local:
                    raise RuntimeError("External network is disabled in local E2E.")
            return original_connect(sock, address)

        socket.socket.connect = local_connect
