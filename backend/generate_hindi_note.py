import subprocess
import os
import tempfile

def generate_hindi_note_image(output_path="/tmp/hindi_note_image.png"):
    """Generate Hindi note image using wkhtmltoimage for proper text rendering"""
    
    html_content = '''<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body {
    margin: 0;
    padding: 5px 10px;
    font-family: 'Noto Sans Devanagari', 'Lohit Devanagari', sans-serif;
    font-size: 14px;
    color: #cc0000;
    background: transparent;
    white-space: nowrap;
}
</style>
</head>
<body>
Note : आप अपनी प्रॉपर्टी ID को सेल्फ सर्टिफाइड करवाए, जिससे कि आपकी प्रॉपर्टी के साथ कोई छेड़ -छाड़ ना कर सके।
</body>
</html>'''
    
    # Write HTML to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as f:
        f.write(html_content)
        html_path = f.name
    
    try:
        # Generate image using wkhtmltoimage with xvfb
        cmd = [
            'xvfb-run', '--auto-servernum',
            'wkhtmltoimage',
            '--encoding', 'utf-8',
            '--width', '900',
            '--height', '40',
            '--quality', '100',
            html_path,
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if os.path.exists(output_path):
            return output_path
        else:
            print(f"Failed to generate image: {result.stderr}")
            return None
    except Exception as e:
        print(f"Error generating Hindi note image: {e}")
        return None
    finally:
        # Cleanup temp file
        if os.path.exists(html_path):
            os.unlink(html_path)

if __name__ == "__main__":
    result = generate_hindi_note_image()
    print(f"Generated: {result}")
