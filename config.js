// 입력폼 연결 설정
// shops: 사업장별 앱스 스크립트 웹 앱 주소. 채널 자동응답 링크에 ?s=<키> 를 붙여 사업장을 고른다.
//   예) https://<아이디>.github.io/order/?s=dad
// 'mock' 으로 두면 시트 없이 체험 모드로 동작한다 (판사 코드 12345678).
window.ORDER_CONFIG = {
  defaultShop: 'dad',
  shops: {
    // 시범 설치 (내 구글 계정, 시트: 주문정산_시범). 아버지 계정으로 옮기면 주소 교체
    dad: 'https://script.google.com/macros/s/AKfycbyhYSI8NMYGqzHW80FYCybWZ4zV9BGVBGTjonyxUHD-29ii5dpPY0W-3oNc5_Sz9n95Wg/exec',
    uncle: 'mock', // 삼촌 사업장: 설치 후 주소 교체
    demo: 'mock',  // 체험용 (?s=demo)
  },
};
