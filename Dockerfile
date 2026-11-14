FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY lct ./lct
ENV LCT_DATA=/data/lct.db
VOLUME /data
EXPOSE 8765
CMD ["python", "-m", "lct", "serve", "--host", "0.0.0.0", "--port", "8765"]
