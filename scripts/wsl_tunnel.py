#!/usr/bin/env python3
import socket, time, threading

WINDOWS_HOST = '172.31.160.1'
CONTROL_PORT = 5433
TARGET_POOL = 5

def handle_channel(win_sock):
    try:
        pg_sock = socket.create_connection(('127.0.0.1', 5432))
    except Exception as e:
        win_sock.close()
        return

    def forward(src, dst):
        try:
            while True:
                buf = src.recv(8192)
                if not buf:
                    break
                dst.sendall(buf)
        except Exception:
            pass
        finally:
            try: dst.shutdown(socket.SHUT_WR)
            except Exception: pass
            try: dst.close()
            except Exception: pass

    threading.Thread(target=forward, args=(win_sock, pg_sock), daemon=True).start()
    forward(pg_sock, win_sock)

def worker():
    while True:
        try:
            s = socket.create_connection((WINDOWS_HOST, CONTROL_PORT), timeout=30)
            cmd = s.recv(1)
            if cmd == b'A':
                handle_channel(s)
            else:
                s.close()
        except Exception:
            time.sleep(1)

def main():
    threads = []
    for _ in range(TARGET_POOL):
        t = threading.Thread(target=worker, daemon=True)
        t.start()
        threads.append(t)
    
    while True:
        time.sleep(1)

if __name__ == '__main__':
    main()
