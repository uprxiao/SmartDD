function willyou_capture_buffer() { print -rn -- "$BUFFER" > "$WILLYOU_ZLE_SNAPSHOT"; zle -R }
zle -N willyou_capture_buffer
bindkey "^X^T" willyou_capture_buffer
