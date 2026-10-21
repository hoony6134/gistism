// 폰 프레임 에디터 설정. 부스의 booth/config.js 와 같은 Supabase 값을 넣는다.
window.EDITOR_CONFIG = {
  supabaseUrl: 'https://nksgzjdycylfyqiqedfa.supabase.co',
  supabaseAnonKey: 'sb_publishable_ir0A60NTfHR46gijxIU6ow_EXxQqZ7M',
  maxAgeHours: 48,      // 부스에서 번호로 불러올 수 있는 시간 (booth의 customFrameMaxAgeHours와 같게)
  aiEnabled: false,     // true면 "AI로 캐릭터 프레임 만들기" 카드를 보여 준다
  aiAutoEnabled: false, // true면 "바로 생성하기"(유료 Gemini API) 버튼을 보여 준다. 서버 함수·API 키 설정 후에 켜기
  aiPerDevice: 5,       // 같은 폰에서 하루 바로 생성 횟수 (서버에도 하루 전체 한도 DAILY_LIMIT가 따로 있음)
};
