;(() => {
  const toggle = document.getElementById('theme-toggle')
  const setTheme = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    toggle.textContent = dark ? 'Light theme' : 'Dark theme'
    toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`)
  }
  setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches)
  toggle.addEventListener('click', () => setTheme(document.documentElement.dataset.theme !== 'dark'))

  const wage = document.getElementById('monthly-wage')
  const updateWage = () => {
    const value = Number(wage.value)
    const oldMonths = 600 / value
    document.getElementById('wage-value').textContent = `${value} coins`
    document.getElementById('fixed-months').textContent = `${Number(oldMonths.toFixed(1))} months`
    document.getElementById('fixed-bar').style.setProperty('--value', `${(oldMonths / 60) * 100}%`)
    document.getElementById('linked-fee').textContent = `${6 * value} coins = six current monthly wages`
    wage.setAttribute(
      'aria-valuetext',
      `${value} coins per month; fixed fee costs ${Number(oldMonths.toFixed(1))} months of wages; wage-linked fee costs six`,
    )
  }
  wage.addEventListener('input', updateWage)
  updateWage()
})()
