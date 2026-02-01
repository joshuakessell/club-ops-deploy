#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required" >&2
    exit 1
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing required tool '$1'" >&2
    exit 1
  }
}

need_cmd aws
need_cmd docker
need_cmd git

aws sts get-caller-identity >/dev/null

required APP_RUNNER_SERVICE_ARN
required KIOSK_TOKEN

ECR_REPO_URI="${ECR_REPO_URI:-146469921099.dkr.ecr.us-east-1.amazonaws.com/club-ops-api}"
IMAGE_TAG_SHA="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
IMAGE_SHA_TAG="${ECR_REPO_URI}:${IMAGE_TAG_SHA}"
IMAGE_LATEST_TAG="${ECR_REPO_URI}:dev-latest"

# DB config: prefer DATABASE_URL, otherwise require discrete DB_* vars
if [[ -z "${DATABASE_URL:-}" ]]; then
  required DB_HOST
  required DB_PORT
  required DB_NAME
  required DB_USER
  required DB_PASSWORD
fi

AWS_REGION="${AWS_REGION:-us-east-1}"

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "${ECR_REPO_URI%/*}"

cd "$ROOT_DIR"

docker build -t "$IMAGE_SHA_TAG" -f services/api/Dockerfile .
docker tag "$IMAGE_SHA_TAG" "$IMAGE_LATEST_TAG"

docker push "$IMAGE_SHA_TAG"
docker push "$IMAGE_LATEST_TAG"

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

# Build runtime env vars payload
runtime_env_vars=(
  "PORT=3000"
  "HOST=0.0.0.0"
  "KIOSK_TOKEN=${KIOSK_TOKEN}"
)

if [[ -n "${DATABASE_URL:-}" ]]; then
  runtime_env_vars+=("DATABASE_URL=${DATABASE_URL}")
else
  runtime_env_vars+=("DB_HOST=${DB_HOST}")
  runtime_env_vars+=("DB_PORT=${DB_PORT}")
  runtime_env_vars+=("DB_NAME=${DB_NAME}")
  runtime_env_vars+=("DB_USER=${DB_USER}")
  runtime_env_vars+=("DB_PASSWORD=${DB_PASSWORD}")
fi

if [[ -n "${LOG_LEVEL:-}" ]]; then
  runtime_env_vars+=("LOG_LEVEL=${LOG_LEVEL}")
fi

cat > "$TMP_JSON" <<JSON
{
  "ServiceArn": "${APP_RUNNER_SERVICE_ARN}",
  "SourceConfiguration": {
    "ImageRepository": {
      "ImageIdentifier": "${IMAGE_LATEST_TAG}",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
JSON

first=1
for kv in "${runtime_env_vars[@]}"; do
  key="${kv%%=*}"
  val="${kv#*=}"
  if [[ $first -eq 0 ]]; then
    echo "," >> "$TMP_JSON"
  fi
  first=0
  printf '          "%s": "%s"' "$key" "$val" >> "$TMP_JSON"
done

echo "" >> "$TMP_JSON"
cat >> "$TMP_JSON" <<JSON
        }
      }
    },
    "AutoDeploymentsEnabled": false
  }
}
JSON

aws apprunner update-service --cli-input-json file://"$TMP_JSON"

# Wait for App Runner to become RUNNING
for i in {1..60}; do
  status="$(aws apprunner describe-service --service-arn "$APP_RUNNER_SERVICE_ARN" --query 'Service.Status' --output text)"
  echo "App Runner status: $status"
  if [[ "$status" == "RUNNING" ]]; then
    break
  fi
  if [[ "$status" == "CREATE_FAILED" || "$status" == "DELETE_FAILED" || "$status" == "OPERATION_FAILED" ]]; then
    echo "ERROR: App Runner entered failure state: $status" >&2
    exit 1
  fi
  sleep 10
done

echo "✓ App Runner update submitted for ${APP_RUNNER_SERVICE_ARN}"
