#!/bin/bash
# 포토부스 Mac 테스트 실행기 (맥북 내장 카메라로 시험해 볼 때)
# 더블클릭하면 로컬 서버 + Chrome 창이 뜬다. Chrome 창을 닫으면 서버도 같이 꺼진다.
cd "$(dirname "$0")" || exit 1

PORT=8787
URL="http://localhost:$PORT/booth/"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# 이전에 켜 둔 서버가 남아 있으면 정리
lsof -ti tcp:$PORT | xargs kill 2>/dev/null

python3 server.py &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null "http://localhost:$PORT/api/frames" && break
  sleep 0.3
done

if [ -x "$CHROME" ]; then
  echo "포토부스 실행 중 — Chrome 창을 닫으면 종료됩니다."
  # 별도 프로필로 열어서 평소 쓰는 Chrome과 섞이지 않게 한다.
  # 카메라 허용 창은 건너뛴다 (macOS가 처음 한 번 Chrome의 카메라 권한을 물어볼 수는 있음).
  "$CHROME" \
    --user-data-dir="$PWD/.browser-profile-mac" \
    --no-first-run \
    --no-default-browser-check \
    --use-fake-ui-for-media-stream \
    --autoplay-policy=no-user-gesture-required \
    --app="$URL" >/dev/null 2>&1
else
  echo "Chrome이 없어 기본 브라우저로 엽니다. 다 쓰면 이 창에서 Enter를 누르세요."
  open "$URL"
  read -r
fi
