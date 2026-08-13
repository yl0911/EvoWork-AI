#!/usr/bin/env bash
# EvoWork-AI Shell Hook — 每条命令执行后自动上报到采集服务。
# 安装方式: 通过 install_shell_hook.py 自动追加到 .bashrc / .zshrc
# 也可手动 source 此文件: source /path/to/shell_hook.sh

# ── 配置 ──────────────────────────────────────────
EVOWORK_SHELL_API="${EVOWORK_SHELL_API:-http://127.0.0.1:8000/api/collect/shell}"
EVOWORK_SHELL_BATCH_API="${EVOWORK_SHELL_BATCH_API:-http://127.0.0.1:8000/api/collect/shell/batch}"
EVOWORK_BUFFER_FILE="${EVOWORK_BUFFER_FILE:-$HOME/.evowork_shell_buffer.log}"
EVOWORK_FLUSH_INTERVAL="${EVOWORK_FLUSH_INTERVAL:-30}"  # 秒，缓冲区刷新间隔
EVOWORK_SHELL_ENABLED="${EVOWORK_SHELL_ENABLED:-1}"
EVOWORK_API_KEY="${EVOWORK_API_KEY:-}"

# 内部状态
_evowork_last_flush=0

# API Key 认证头（仅在 EVOWORK_API_KEY 非空时生效）
_evowork_auth_header() {
    if [ -n "$EVOWORK_API_KEY" ]; then
        printf '-H "X-API-Key: %s"' "$EVOWORK_API_KEY"
    fi
}

# ── Hook 函数 ─────────────────────────────────────

_evowork_shell_hook() {
    [ "$EVOWORK_SHELL_ENABLED" = "0" ] && return 0

    local exit_code=$?
    local cmd

    # 获取最后执行的命令
    if [ -n "$BASH_VERSION" ]; then
        # bash: 从 HISTTIMEFORMAT 无关的方式获取
        cmd=$(HISTTIMEFORMAT='' history 1 | sed 's/^[ ]*[0-9]\+[ ]*//')
    elif [ -n "$ZSH_VERSION" ]; then
        # zsh: fc -ln -1 获取最后一条命令
        cmd=$(fc -ln -1 2>/dev/null | sed 's/^[[:space:]]*//')
    else
        return 0
    fi

    # 跳过空命令和 hook 自身的命令
    [ -z "$cmd" ] && return 0
    case "$cmd" in
        _evowork_*) return 0 ;;
    esac

    local cwd
    cwd=$(pwd)
    local shell_type="bash"
    [ -n "$ZSH_VERSION" ] && shell_type="zsh"
    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%S+00:00")

    local payload
    payload=$(printf '{"command":%s,"exit_code":%d,"cwd":%s,"shell_type":"%s","executed_at":"%s"}' \
        "$(printf '%s' "$cmd" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$cmd")" \
        "$exit_code" \
        "$(printf '%s' "$cwd" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$cwd")" \
        "$shell_type" \
        "$now")

    # 尝试发送，失败则写入本地缓冲
    if command -v curl >/dev/null 2>&1; then
        local auth_hdr=""
        [ -n "$EVOWORK_API_KEY" ] && auth_hdr="-H \"X-API-Key: $EVOWORK_API_KEY\""
        eval curl -s -X POST \
            -H '"Content-Type: application/json"' \
            $auth_hdr \
            -d '"$payload"' \
            --connect-timeout 2 \
            --max-time 3 \
            '"$EVOWORK_SHELL_API"' >/dev/null 2>&1 '&'
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "
import urllib.request, json, sys, os
try:
    headers = {'Content-Type': 'application/json'}
    api_key = os.environ.get('EVOWORK_API_KEY', '')
    if api_key:
        headers['X-API-Key'] = api_key
    req = urllib.request.Request('$EVOWORK_SHELL_API',
        data=json.dumps(json.loads('''$payload''')).encode(),
        headers=headers, method='POST')
    urllib.request.urlopen(req, timeout=3)
except: pass
" >/dev/null 2>&1 &
    else
        # 写入缓冲区，下次批量补发
        echo "$payload" >> "$EVOWORK_BUFFER_FILE"
    fi

    # 定时刷新缓冲区
    local now_ts
    now_ts=$(date +%s)
    if [ $((now_ts - _evowork_last_flush)) -ge "$EVOWORK_FLUSH_INTERVAL" ]; then
        _evowork_flush_buffer
        _evowork_last_flush=$now_ts
    fi
}

# ── 缓冲区刷新 ────────────────────────────────────

_evowork_flush_buffer() {
    [ ! -f "$EVOWORK_BUFFER_FILE" ] && return 0
    [ ! -s "$EVOWORK_BUFFER_FILE" ] && return 0

    local items=""
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        items="${items}${items:+, }${line}"
    done < "$EVOWORK_BUFFER_FILE"

    [ -z "$items" ] && return 0

    local batch_payload
    batch_payload=$(printf '{"source":"shell_buffer","commands":[%s]}' "$items")

    if curl -s -X POST \
        -H "Content-Type: application/json" \
        $([ -n "$EVOWORK_API_KEY" ] && printf -- '-H "X-API-Key: %s"' "$EVOWORK_API_KEY") \
        -d "$batch_payload" \
        --connect-timeout 3 \
        --max-time 10 \
        "$EVOWORK_SHELL_BATCH_API" >/dev/null 2>&1; then
        # 发送成功，清空缓冲区
        > "$EVOWORK_BUFFER_FILE"
    fi
}

# ── 注册 Hook ─────────────────────────────────────

if [ -n "$BASH_VERSION" ]; then
    # bash: 追加到 PROMPT_COMMAND
    if [[ "$PROMPT_COMMAND" != *"_evowork_shell_hook"* ]]; then
        PROMPT_COMMAND="_evowork_shell_hook;${PROMPT_COMMAND}"
    fi
elif [ -n "$ZSH_VERSION" ]; then
    # zsh: 注册 precmd hook
    autoload -Uz add-zsh-hook 2>/dev/null
    if typeset -f add-zsh-hook >/dev/null 2>&1; then
        add-zsh-hook precmd _evowork_shell_hook
    else
        precmd_functions+=(_evowork_shell_hook)
    fi
fi
