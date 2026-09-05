"""以新会话（setsid 等价）启动进程，脱离调用 shell 的进程组。

用途：在受管 shell 环境里启动本地服务时，普通 `nohup cmd &` 会随 shell
会话回收被杀掉；本脚本用 start_new_session 新建会话，使其独立于调用方存活。
"""
import os
import sys


def daemonize(argv: list[str], stdout_path: str, stderr_path: str, cwd: str, env: dict) -> int:
    os.makedirs(os.path.dirname(stdout_path), exist_ok=True)
    out = open(stdout_path, "ab", buffering=0)
    err = open(stderr_path, "ab", buffering=0)

    pid = os.fork()
    if pid > 0:
        # 父进程立即返回，子进程由 init/launchd 收养
        print(f"spawned child pid={pid}")
        return 0

    # ── 子进程 ──
    os.setsid()  # 脱离原会话与进程组
    os.chdir(cwd)
    devnull = open(os.devnull, "rb")
    os.dup2(devnull.fileno(), 0)
    os.dup2(out.fileno(), 1)
    os.dup2(err.fileno(), 2)
    os.execvpe(argv[0], argv, env)


if __name__ == "__main__":
    # 用法: spawn.py <cwd> <stdout> <stderr> -- <cmd...>
    args = sys.argv[1:]
    sep = args.index("--")
    cwd, so, se = args[0], args[1], args[2]
    cmd = args[sep + 1:]
    env = dict(os.environ)
    raise SystemExit(daemonize(cmd, so, se, cwd, env))
