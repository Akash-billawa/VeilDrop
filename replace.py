import pathlib

p = pathlib.Path(r'C:\DataSecure\frontend\js\site.js')
text = p.read_text('utf-8')

replacements = {
    'We minimize what the system can': 'I minimize what the system can',
    'trust our word': 'trust my word',
    'What we never see': 'What I never see',
    'We exist so that people can speak': 'I built this so that people can speak',
    "We built one where you don't have to.": "I built one where you don't have to.",
    'Metrics that stem from our architecture': 'Metrics that stem from my architecture',
    'Our story': 'My story',
    'We started with a simple observation': 'I started with a simple observation',
    'we decided to remove': 'I decided to remove',
    'We would rather publish our threat model': 'I would rather publish my threat model',
    'What we optimise for': 'What I optimise for',
    'touches our servers': 'touches the servers',
    'We publish exactly what the system': 'I publish exactly what the system',
    'how much to trust us': 'how much to trust the system',
    'We cannot tie': 'I cannot tie',
    'we recommend': 'I recommend',
    'We publish our cryptographic': 'I publish the cryptographic',
    'Contact us for': 'Contact me for',
    'Contact us</a>': 'Contact me</a>',
    "We'd love to hear from you.": "I'd love to hear from you.",
    'Tell us a little more': 'Tell me a little more',
    "We're happy to walk through": "I'm happy to walk through",
    "We'll respond to verified requests": "I'll respond to verified requests",
    'even by staff.': 'even by me.',
    'even by VeilDrop staff.': 'even by me.'
}

for k, v in replacements.items():
    text = text.replace(k, v)

p.write_text(text, 'utf-8')
print('Replacements done.')
