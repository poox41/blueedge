FROM python:3.11-slim

WORKDIR /opt/blueedge-model-sync
COPY model-sync/executor.py /opt/blueedge-model-sync/executor.py

ENTRYPOINT ["python", "/opt/blueedge-model-sync/executor.py"]
