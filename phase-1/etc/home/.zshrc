## File load order:
# .zshenv → [.zprofile if login] → [.zshrc if interactive] → [.zlogin if login] → [.zlogout sometimes].

# Load $PATH again, idempotently
[ -f ~/.pathrc ] && . ~/.pathrc

# Load organized configs
for config (~/.zsh/*.zsh) source $config

# Zsh initialization
autoload -Uz compinit promptinit
compinit
promptinit

# Enable history and extended completion
setopt hist_ignore_all_dups share_history append_history extended_glob
# Use fcntl() file locking for history to avoid lockfile permission issues
setopt hist_fcntl_lock
HISTFILE=${HISTFILE:-~/.zsh_history}
HISTSIZE=${HISTSIZE:-100000}
SAVEHIST=${SAVEHIST:-100000}

# Plugins and features
source /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
source /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
source /usr/share/zsh/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh

# Smart paste mode
autoload -Uz bracketed-paste-magic
zle -N bracketed-paste bracketed-paste-magic

# fzf integration
[ -f /usr/share/fzf/key-bindings.zsh ] && source /usr/share/fzf/key-bindings.zsh
[ -f /usr/share/fzf/completion.zsh ] && source /usr/share/fzf/completion.zsh

# Git prompt via Starship
eval "$(starship init zsh)"
