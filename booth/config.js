// 포토부스 설정. 행사 전에 이 파일만 고치면 된다.
window.BOOTH_CONFIG = {
  title: '서비스러닝 포토부스',

  // 촬영
  // 아래 세 값은 기본값. 관리자 메뉴 → 촬영 설정에서 바꾸면 그 값이 우선 (이 PC에 저장)
  countdownSeconds: 5,      // 첫 장 카운트다운
  nextCountdownSeconds: 4,  // 두 번째 장부터
  extraShots: 2,            // 프레임 칸 수보다 더 찍는 장수 (4칸이면 6장 찍고 4장 고름)
  mirror: true,             // 거울처럼 좌우 반전 (미리보기와 결과물 모두)
  sound: true,              // 카운트다운 삑 소리와 셔터 소리 (관리자 메뉴에서도 끄고 켤 수 있음)
  cameraWidth: 1920,
  cameraHeight: 1080,
  fakeCameraFallback: true, // 카메라가 없으면 테스트 화면으로 대신 (개발용)

  // 인쇄 (SELPHY CP1500 엽서 용지 100×148mm)
  paperWidthMm: 100,
  paperHeightMm: 148,
  maxCopies: 2,             // 한 번에 뽑을 수 있는 최대 장수 (한 장에 스트립 2개)

  // 화면
  idleSeconds: 60,          // 아무 입력이 없으면 처음 화면으로
  doneSeconds: 45,          // 완료 화면 유지 시간
  adminPin: '0000',         // 왼쪽 위 모서리를 5번 연속 터치 → 관리자 메뉴

  // 폰에서 만든 프레임(4자리 번호) 쓰기. false면 우리가 넣은 프레임만 (frames/normal, frames/character)
  customFrames: false,

  // 클라우드 (Supabase). 비워두면 커스텀 프레임·다운로드 QR 기능이 꺼진다.
  supabaseUrl: 'https://nksgzjdycylfyqiqedfa.supabase.co',
  supabaseAnonKey: 'sb_publishable_ir0A60NTfHR46gijxIU6ow_EXxQqZ7M',
  editorUrl: 'https://gistism.scian.xyz/', // 사진 받기 페이지(editor/photo.html)가 올라간 Vercel 주소
  customFrameMaxAgeHours: 48,

  // 완료 화면에 띄울 설문 QR (비워두면 표시 안 함)
  surveyUrl: '',
};
