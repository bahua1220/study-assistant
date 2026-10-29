export async function photoFixtures(page) {
  const data = await page.evaluate(() => ['apple', 'banana', 'cat'].map((word, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = 600; canvas.height = 300
    const context = canvas.getContext('2d')
    context.fillStyle = ['#fff9ed', '#efffee', '#eef6ff'][index]
    context.fillRect(0, 0, 600, 300)
    context.fillStyle = '#111'; context.font = '60px sans-serif'; context.fillText(word, 50, 150)
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  }))
  return data.map((base64, index) => ({ name: `photo-${index + 1}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') }))
}
