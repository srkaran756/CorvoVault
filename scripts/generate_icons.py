import os
from PIL import Image

def main():
    # Destination path relative to project structure
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    public_dir = os.path.join(project_root, "public")
    resources_dir = os.path.join(project_root, "resources")
    
    source_img_path = os.path.join(resources_dir, "logo_source.png")
    if not os.path.exists(source_img_path):
        source_img_path = os.path.join(public_dir, "icon.png")
    
    if not os.path.exists(public_dir):
        os.makedirs(public_dir, exist_ok=True)

    print("Loading source images...")
    
    def pad_to_square(img_path):
        with Image.open(img_path) as img:
            w, h = img.size
            size = max(w, h)
            # Create transparent background square
            square = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            # Center source image
            x = (size - w) // 2
            y = (size - h) // 2
            square.paste(img, (x, y))
            return square.copy()

    print(f"Processing logo image from {source_img_path}...")
    img_close_square = pad_to_square(source_img_path)
    img_full_square = img_close_square
    
    # 1. Save PNG icon (512x512)
    icon_png_path = os.path.join(public_dir, "icon.png")
    img_close_square.resize((512, 512), Image.Resampling.LANCZOS).save(icon_png_path, format="PNG")
    print(f"Saved: {icon_png_path}")
    
    # 2. Save full logo PNG (512x512)
    logo_full_path = os.path.join(public_dir, "logo_full.png")
    img_full_square.resize((512, 512), Image.Resampling.LANCZOS).save(logo_full_path, format="PNG")
    print(f"Saved: {logo_full_path}")
    
    # 3. Save Windows ICO containing multiple sizes
    icon_ico_path = os.path.join(public_dir, "icon.ico")
    ico_sizes = [16, 32, 48, 64, 256]
    # Resize the image to 256x256 as the base, then save with different sizes
    img_close_256 = img_close_square.resize((256, 256), Image.Resampling.LANCZOS)
    img_close_256.save(icon_ico_path, format="ICO", sizes=[(s, s) for s in ico_sizes])
    print(f"Saved: {icon_ico_path}")
    
    # 4. Save macOS ICNS containing multiple sizes
    icon_icns_path = os.path.join(public_dir, "icon.icns")
    # ICNS standard sizes: 16, 32, 64, 128, 256, 512, 1024
    img_close_1024 = img_close_square.resize((1024, 1024), Image.Resampling.LANCZOS)
    img_close_1024.save(icon_icns_path, format="ICNS")
    print(f"Saved: {icon_icns_path}")
    
    print("All icons successfully generated!")

if __name__ == "__main__":
    main()
