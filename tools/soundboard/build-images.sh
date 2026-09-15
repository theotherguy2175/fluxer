#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build the four Fluxer images that carry the soundboard changes, using the
# unmodified upstream Dockerfiles. Same images and build args as
# .github/workflows/soundboard-images.yaml, for when you want to build on
# your own machine instead of GitHub Actions.
#
#   tools/soundboard/build-images.sh                       # build, load locally
#   tools/soundboard/build-images.sh --push                # build and push
#   tools/soundboard/build-images.sh --push --registry ghcr.io/you
#   tools/soundboard/build-images.sh --only api,app-proxy --push
#
# Options (env var in brackets):
#   --registry <prefix>   image prefix              [REGISTRY]   default ghcr.io/theotherguy2175
#   --tag <tag>           immutable tag             [TAG]        default sb-<YYYYMMDD>-<sha7>
#   --platform <list>     buildx platforms          [PLATFORM]   default linux/amd64
#   --only <a,b>          subset of: api gateway media-proxy app-proxy
#   --push                push to the registry (also applies the moving :soundboard tag);
#                         without it the image is loaded into the local docker (single platform only)
#   --no-cache            pass --no-cache to buildx
#
# Cross-building (e.g. linux/amd64 from an Apple Silicon Mac) works through
# Docker Desktop's emulation; expect ~10 min each for api and app-proxy.
set -eu

cd "$(dirname "$0")/../.."

REGISTRY="${REGISTRY:-ghcr.io/theotherguy2175}"
PLATFORM="${PLATFORM:-linux/amd64}"
TAG="${TAG:-}"
ONLY=""
PUSH=0
NOCACHE=""

while [ $# -gt 0 ]; do
	case "$1" in
		--registry) REGISTRY="$2"; shift 2 ;;
		--tag) TAG="$2"; shift 2 ;;
		--platform) PLATFORM="$2"; shift 2 ;;
		--only) ONLY="$2"; shift 2 ;;
		--push) PUSH=1; shift ;;
		--no-cache) NOCACHE="--no-cache"; shift ;;
		-h|--help) sed -n '3,30p' "$0"; exit 0 ;;
		*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
done

SHA="$(git rev-parse HEAD)"
DATE="$(TZ=UTC git log -1 --no-show-signature --pretty=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ)"
[ -n "$TAG" ] || TAG="sb-$(date -u +%Y%m%d)-$(printf %s "$SHA" | cut -c1-7)"

if [ -n "$(git status --porcelain -- fluxer_api fluxer_app fluxer_gateway fluxer_media_proxy fluxer_app_proxy packages)" ]; then
	echo "warning: working tree has uncommitted changes; the image will not match $SHA" >&2
fi

if [ "$PUSH" = 1 ]; then
	OUTPUT="--push"
else
	case "$PLATFORM" in *,*) echo "--load supports one platform; add --push for multi-arch" >&2; exit 2 ;; esac
	OUTPUT="--load"
fi

want() { [ -z "$ONLY" ] || printf ',%s,' "$ONLY" | grep -q ",$1,"; }

build() {
	name="$1"; dockerfile="$2"; shift 2
	set -- "$@"
	tags="-t $REGISTRY/$name:$TAG"
	[ "$PUSH" = 1 ] && tags="$tags -t $REGISTRY/$name:soundboard"
	echo "==> $name  ($PLATFORM)  $REGISTRY/$name:$TAG"
	# shellcheck disable=SC2086
	docker buildx build --platform "$PLATFORM" -f "$dockerfile" $OUTPUT $NOCACHE $tags \
		--build-arg "BUILD_VERSION=$TAG" --build-arg "SOURCE_SHA=$SHA" --build-arg "SOURCE_DATE=$DATE" \
		"$@" .
}

want api         && build fluxer-api                   fluxer_api/Dockerfile
want gateway     && build fluxer-gateway               fluxer_gateway/Dockerfile
want media-proxy && build fluxer-media-proxy           fluxer_media_proxy/Dockerfile
want app-proxy   && build fluxer-app-proxy-self-hosted fluxer_app_proxy/Dockerfile \
	--build-arg FLUXER_APP_PROXY_TIME_FREEZE_ENABLED=false \
	--build-arg APP_ASSETS_PLATFORM=linux/amd64

echo
echo "done: tag $TAG"
[ "$PUSH" = 1 ] && echo "compose: SOUNDBOARD_REGISTRY=$REGISTRY SOUNDBOARD_IMAGE_TAG=$TAG" || true
