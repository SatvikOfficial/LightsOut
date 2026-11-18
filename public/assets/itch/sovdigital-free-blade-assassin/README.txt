Blade Assassin Boss - Free  -  version 1.1.2

1 top-down boss in 2 forms (normal and enraged), 8 directions each, plus 2 effects.

- Blade Assassin: attack (blink strike), attack2 (phase rush), attack3 (blade slash), attack4 (whirlwind), death, hurt, idle, run, walk (415x361 px frames); attack 6, attack2 6, attack3 6, attack4 6, death 6, hurt 6, idle 4, run 6, walk 6 frames per direction
- Blade Assassin (Enraged): attack (blink strike), attack2 (phase rush), attack3 (blade slash), attack4 (whirlwind), death, hurt, idle, run, walk (415x361 px frames); attack 6, attack2 6, attack3 6, attack4 6, death 6, hurt 6, idle 4, run 6, walk 6 frames per direction

Both forms share the same frame size and feet pivot, so you can swap the enraged form in at any point (for example at half health).
Effects are in effects/<name>/: a horizontal sheet, single frames and a JSON with frame size and FPS.
Includes PNG artwork, animation metadata and Godot 4 SpriteFrames. Other engines can import the PNGs; their animation setup must be configured separately.

COLOUR VARIATIONS (ColourVariations/, optional: delete the folder if you don't need it)
  ColourVariations/<variation>/<name>/  every animation of a character in another colour variation: the same
      sheets, frame size, feet pivot and Godot SpriteFrames as characters/<name>/ (sheets only; slice
      them like the main sheets). Previews: previews/<name>_colour_variations.png
  - Blade Assassin: Azure (azure/), Venom Green (venom/), Violet (violet/)
  ColourVariations/recolour_masks/<name>/<clip>.png  material masks in the same layout as the sheets
      (red = main material, green = second material) for your own colours at runtime.
  ColourVariations/godot/recolour_mask.gdshader + recolour_masks.gd  Godot 4: give the AnimatedSprite2D a
      ShaderMaterial with the shader, attach the script, set masks_dir, then pick colour_main / colour_second.
