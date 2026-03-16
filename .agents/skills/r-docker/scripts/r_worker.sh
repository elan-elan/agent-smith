#!/usr/bin/env bash
# r_worker.sh — Manage a persistent R Docker container for experiment loops.
#
# Avoids per-run overhead of container creation and package installation.
# Packages are installed once at start; each experiment is a fast `docker exec`.
#
# Subcommands:
#   start  <data_dir> [output_dir] [-- pkg1 pkg2 ...]   Create container, install packages
#   run    <r_script> [timeout_seconds]                  Execute R script in running container
#   stop                                                 Destroy container
#   status                                               Check if container is running
#
# Examples:
#   bash r_worker.sh start data/prepared r_output -- earth e1071
#   bash r_worker.sh run train.R 300
#   bash r_worker.sh run train.R 300 2>&1 | tee run.log
#   bash r_worker.sh stop

set -euo pipefail

DOCKER_IMAGE="rocker/r-ver:latest"
CONTAINER_NAME="r-worker"

# ── Helpers ──────────────────────────────────────────────────────────

is_running() {
  docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true
}

container_exists() {
  docker inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker is not running." >&2
    exit 1
  fi
}

# ── start ────────────────────────────────────────────────────────────

cmd_start() {
  ensure_docker

  if is_running; then
    echo "Worker already running (container: $CONTAINER_NAME)"
    echo "Use 'r_worker.sh stop' first to restart with new settings."
    return 0
  fi

  # Clean up stale container if it exists but isn't running
  if container_exists; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  # Parse: start <data_dir> [output_dir] [-- pkg1 pkg2 ...]
  if [ $# -lt 1 ]; then
    echo "Usage: r_worker.sh start <data_dir> [output_dir] [-- pkg1 pkg2 ...]" >&2
    exit 1
  fi

  local data_dir
  data_dir="$(cd "$1" && pwd)"
  shift

  local output_dir="./r_output"
  if [ $# -gt 0 ] && [ "$1" != "--" ]; then
    output_dir="$1"
    shift
  fi
  mkdir -p "$output_dir"
  output_dir="$(cd "$output_dir" && pwd)"

  # Collect packages after --
  local packages=()
  if [ $# -gt 0 ] && [ "$1" = "--" ]; then
    shift
    packages=("$@")
  fi

  # Pull image if needed
  if ! docker image inspect "$DOCKER_IMAGE" >/dev/null 2>&1; then
    echo "Pulling $DOCKER_IMAGE..."
    docker pull "$DOCKER_IMAGE"
  fi

  echo "Starting persistent R worker..."
  echo "  Data:    $data_dir"
  echo "  Output:  $output_dir"

  # Create a scripts directory in the container for copying scripts into
  docker run -d \
    --name "$CONTAINER_NAME" \
    -v "$data_dir":/workspace/data:ro \
    -v "$output_dir":/workspace/output \
    -w /workspace \
    "$DOCKER_IMAGE" \
    tail -f /dev/null >/dev/null

  echo "  Container: $CONTAINER_NAME (running)"

  # Install packages if requested
  if [ ${#packages[@]} -gt 0 ]; then
    local pkg_list
    pkg_list=$(printf '"%s",' "${packages[@]}")
    pkg_list="c(${pkg_list%,})"
    echo "  Installing R packages: ${packages[*]}"
    docker exec "$CONTAINER_NAME" Rscript -e "
      pkgs <- $pkg_list
      for (p in pkgs) {
        if (!requireNamespace(p, quietly = TRUE)) {
          cat('  Installing', p, '...\n')
          install.packages(p, repos = 'https://cloud.r-project.org', quiet = TRUE)
        } else {
          cat('  ', p, 'already installed\n')
        }
      }
      cat('Package setup complete.\n')
    "
  fi

  echo "Worker ready."
}

# ── run ──────────────────────────────────────────────────────────────

cmd_run() {
  ensure_docker

  if ! is_running; then
    echo "Error: worker not running. Use 'r_worker.sh start' first." >&2
    exit 1
  fi

  if [ $# -lt 1 ]; then
    echo "Usage: r_worker.sh run <r_script> [timeout_seconds]" >&2
    exit 1
  fi

  local r_script="$1"
  local timeout_secs="${2:-600}"

  if [ ! -f "$r_script" ]; then
    echo "Error: R script not found: $r_script" >&2
    exit 1
  fi

  # Copy the script into the container (allows editing between runs)
  docker cp "$r_script" "$CONTAINER_NAME":/workspace/script.R

  # Execute with timeout
  timeout "$timeout_secs" \
    docker exec "$CONTAINER_NAME" \
    Rscript /workspace/script.R /workspace/data /workspace/output

  local exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "Error: R script timed out after ${timeout_secs}s" >&2
    return 124
  fi
  return $exit_code
}

# ── stop ─────────────────────────────────────────────────────────────

cmd_stop() {
  if container_exists; then
    echo "Stopping worker..."
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1
    echo "Worker stopped and removed."
  else
    echo "No worker container found."
  fi
}

# ── status ───────────────────────────────────────────────────────────

cmd_status() {
  if is_running; then
    echo "Worker is running (container: $CONTAINER_NAME)"
    # Show installed packages
    docker exec "$CONTAINER_NAME" Rscript -e "
      pkgs <- installed.packages()[, 'Package']
      base_pkgs <- rownames(installed.packages(priority = 'base'))
      extra <- setdiff(pkgs, base_pkgs)
      if (length(extra) > 0) cat('Installed packages:', paste(extra, collapse = ', '), '\n')
    " 2>/dev/null || true
    return 0
  elif container_exists; then
    echo "Worker container exists but is not running."
    return 1
  else
    echo "No worker container found."
    return 1
  fi
}

# ── install (add packages to a running worker) ──────────────────────

cmd_install() {
  ensure_docker

  if ! is_running; then
    echo "Error: worker not running. Use 'r_worker.sh start' first." >&2
    exit 1
  fi

  if [ $# -lt 1 ]; then
    echo "Usage: r_worker.sh install <pkg1> [pkg2 ...]" >&2
    exit 1
  fi

  local pkg_list
  pkg_list=$(printf '"%s",' "$@")
  pkg_list="c(${pkg_list%,})"
  echo "Installing: $*"
  docker exec "$CONTAINER_NAME" Rscript -e "
    pkgs <- $pkg_list
    for (p in pkgs) {
      if (!requireNamespace(p, quietly = TRUE)) {
        cat('  Installing', p, '...\n')
        install.packages(p, repos = 'https://cloud.r-project.org', quiet = TRUE)
      } else {
        cat('  ', p, 'already installed\n')
      }
    }
    cat('Done.\n')
  "
}

# ── Dispatch ─────────────────────────────────────────────────────────

case "${1:-help}" in
  start)   shift; cmd_start "$@" ;;
  run)     shift; cmd_run "$@" ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  install) shift; cmd_install "$@" ;;
  help|--help|-h)
    echo "Usage: r_worker.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  start  <data_dir> [output_dir] [-- pkg1 pkg2 ...]  Start worker, install packages"
    echo "  run    <r_script> [timeout_seconds]                 Run R script in worker"
    echo "  stop                                                Destroy worker container"
    echo "  status                                              Check worker status"
    echo "  install <pkg1> [pkg2 ...]                           Install packages in running worker"
    ;;
  *)
    echo "Unknown command: $1. Use 'r_worker.sh help'." >&2
    exit 1
    ;;
esac
