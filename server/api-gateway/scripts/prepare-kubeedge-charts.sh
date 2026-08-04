#!/bin/sh
set -eu

CHART_ROOT="${1:-/opt/blueedge/kubeedge-charts}"
VERSIONS="${KUBEEDGE_CHART_VERSIONS:-v1.19.0 v1.20.0 v1.21.0 v1.22.1}"

mkdir -p "$CHART_ROOT"
for version in $VERSIONS; do
  target="$CHART_ROOT/$version"
  [ -f "$target/cloudcore/Chart.yaml" ] && continue
  archive="/tmp/kubeedge-${version}.tar.gz"
  source_dir="kubeedge-${version#v}"
  curl -L --fail --silent --show-error \
    "https://github.com/kubeedge/kubeedge/archive/refs/tags/${version}.tar.gz" \
    -o "$archive"
  mkdir -p "$target"
  tar -xzf "$archive" -C "$target" --strip-components=3 \
    "$source_dir/manifests/charts/cloudcore"
  rm -f "$archive"
done
