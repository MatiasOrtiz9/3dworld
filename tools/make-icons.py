"""
Genera los iconos de la PWA por codigo.

El proyecto no descarga un solo asset externo, y los iconos no iban a ser la
excepcion. Se dibujan con las mismas formas y colores que el resto: fondo verde
oscuro, sol amarillo y una silueta de ciudad con vegetacion.

Uso: python tools/make-icons.py
"""

from PIL import Image, ImageDraw

INK = (13, 27, 24)
SUN = (242, 193, 78)
LEAF = (79, 170, 122)
LEAF_DARK = (44, 85, 64)
CONCRETE = (239, 231, 216)

SIZES = [192, 512]


def draw_icon(size: int) -> Image.Image:
    # Se dibuja al cuadruple y se reduce al final: es antialiasing por
    # supermuestreo, y evita los bordes escalonados que deja ImageDraw.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), INK + (255,))
    d = ImageDraw.Draw(img)

    # Esquinas redondeadas.
    radius = int(s * 0.22)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)

    u = s / 100.0  # unidad relativa, para que todo escale con el tamano

    # Sol.
    d.ellipse([38 * u, 16 * u, 62 * u, 40 * u], fill=SUN)

    # Torres, de distintas alturas: el perfil escalonado de la ciudad.
    towers = [
        (14, 52, 26, 86),
        (30, 42, 44, 86),
        (48, 46, 60, 86),
        (64, 36, 78, 86),
        (80, 56, 90, 86),
    ]
    for x0, y0, x1, y1 in towers:
        d.rounded_rectangle(
            [x0 * u, y0 * u, x1 * u, y1 * u], radius=int(1.5 * u), fill=CONCRETE
        )
        # Bandas de ventana: dos lineas oscuras por torre.
        for k in range(3):
            wy = (y0 + 6 + k * 9) * u
            if wy < (y1 - 6) * u:
                d.rectangle([(x0 + 2) * u, wy, (x1 - 2) * u, wy + 2.5 * u], fill=INK)

    # Vegetacion en la base: lo que hace que la silueta se lea solarpunk y no
    # como cualquier skyline.
    for cx, r in [(20, 9), (38, 7), (56, 8), (74, 7), (88, 6)]:
        d.ellipse(
            [(cx - r) * u, (84 - r) * u, (cx + r) * u, (84 + r) * u],
            fill=LEAF if cx % 2 == 0 else LEAF_DARK,
        )

    # Suelo.
    d.rectangle([0, 88 * u, s, s], fill=LEAF_DARK)

    img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


for size in SIZES:
    icon = draw_icon(size)
    out = f"public/icon-{size}.png"
    icon.save(out)
    print(f"  {out}  ({size}x{size})")
