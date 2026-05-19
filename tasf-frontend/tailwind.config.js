/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy:  "#021B33",
        teal:  "#1C7293",
        alert: "#F4A261",
        crit:  "#E76F51",
        ok:    "#2A9D8F",
      }
    }
  },
  plugins: [],
}