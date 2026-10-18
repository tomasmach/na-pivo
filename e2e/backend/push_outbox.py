"""Expo push messages captured in memory instead of leaving the machine."""

from collections import deque

messages = deque(maxlen=20)
