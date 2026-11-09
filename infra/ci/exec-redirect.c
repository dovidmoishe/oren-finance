/* Test-only execve redirector. Recompile with:
   cc -shared -fPIC -O2 -s -o exec-redirect.so infra/ci/exec-redirect.c -ldl
   The checked-in base64 blob is the fallback when the runner has no compiler. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>

static const char *replace(const char *pathname) {
  const char *repl = 0;
  if (!pathname) return pathname;
  if (!strcmp(pathname, "/usr/bin/timeout")) repl = getenv("OREN_HOOK_TIMEOUT");
  else if (!strcmp(pathname, "/usr/bin/python3")) repl = getenv("OREN_HOOK_PYTHON");
  else if (!strcmp(pathname, "/opt/oren-ci/toolchain/node-v22.23.4-linux-x64/bin/node"))
    repl = getenv("OREN_HOOK_NODE");
  if (repl && *repl) return repl;
  return pathname;
}

int execve(const char *pathname, char *const argv[], char *const envp[]) {
  static int (*real_execve)(const char *, char *const[], char *const[]) = 0;
  if (!real_execve)
    real_execve = (int (*)(const char *, char *const[], char *const[]))dlsym(RTLD_NEXT, "execve");
  return real_execve(replace(pathname), argv, envp);
}
