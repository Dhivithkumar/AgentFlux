import socket, sys, threading

s = socket.create_connection(('127.0.0.1', 5434))

def to_socket():
    try:
        while True:
            data = sys.stdin.buffer.read(4096)
            if not data:
                break
            s.sendall(data)
    except Exception:
        pass
    finally:
        try:
            s.shutdown(socket.SHUT_WR)
        except Exception:
            pass

def to_stdout():
    try:
        while True:
            data = s.recv(4096)
            if not data:
                break
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
    except Exception:
        pass
    finally:
        try:
            sys.stdout.close()
        except Exception:
            pass

t = threading.Thread(target=to_socket, daemon=True)
t.start()
to_stdout()
s.close()
