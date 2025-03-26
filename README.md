# guardian-crosswords
Simple Guardian crossword scraper script

Credit to Tom Stuart https://github.com/rentalcustard for original code. See https://github.com/rentalcustard/guardianpuz

## Updates
* Updated to work with python 3
* Updated to work with modern Guardian format data
* Updated to scrape solutions and pass to puzpy

## Requirements
* Should run on Python 3+. Not tested.
* [puzpy](https://github.com/alexdej/puzpy) - `pip install puzpy`

## Usage
Open the script in a Python IDE. Change the fields `crossword_type` and `crossword_number` as required. Outputs a file `Guardian_{crossword_type}_{crossword_number}.puz` in your base directory. Can be uploaded into many websites.

Credit to The Guardian for all puzzle content.
