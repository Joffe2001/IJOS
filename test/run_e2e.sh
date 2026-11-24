#!/usr/bin/env bash
# Runs the IJOS browser walkthrough on throwaway data with synthetic files. Never touches ./data.
# Usage: bash test/run_e2e.sh [screenshot-dir]
cd "$(dirname "$0")/.."
PYTHONIOENCODING=utf-8 python test/e2e_walkthrough.py "$@"
