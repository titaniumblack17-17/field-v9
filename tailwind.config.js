export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT:'#378ADD', dark:'#185FA5', light:'#E6F1FB' },
      },
      fontFamily: { sans: ['Inter','system-ui','sans-serif'] }
    }
  }
}
