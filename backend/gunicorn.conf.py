import os


bind = os.environ.get('PINDOU_BIND', '127.0.0.1:8081')
workers = int(os.environ.get('PINDOU_GUNICORN_WORKERS', '1'))
threads = int(os.environ.get('PINDOU_GUNICORN_THREADS', '4'))
worker_class = 'gthread'
timeout = int(os.environ.get('PINDOU_GUNICORN_TIMEOUT', '60'))
graceful_timeout = int(os.environ.get('PINDOU_GUNICORN_GRACEFUL_TIMEOUT', '15'))
keepalive = int(os.environ.get('PINDOU_GUNICORN_KEEPALIVE', '5'))
accesslog = '-'
errorlog = '-'
capture_output = True
loglevel = os.environ.get('PINDOU_GUNICORN_LOG_LEVEL', 'info')
proc_name = 'pindou-api'