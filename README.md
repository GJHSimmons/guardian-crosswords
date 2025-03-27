# guardian-crosswords
Simple Guardian crossword scraper script

Credit to Tom Stuart https://github.com/rentalcustard for original code. See https://github.com/rentalcustard/guardianpuz.

Credit to The Guardian for all puzzle content.

## Updates from original
* Works with python 3.
* Works with newer Guardian format data.
* Scrapes solutions from crosswords which are not Prize or Everyman.

## Requirements
* Should run on Python 3+. Only tested on 3.11.
* [puzpy](https://github.com/alexdej/puzpy) - `pip install puzpy`

## Usage
Open the script in a Python IDE. Change the fields `crossword_type` and `crossword_number` as required. Outputs a file `Guardian_{crossword_type}_{crossword_number}.puz` in `outputs/{crossword_type}/`. Can be uploaded into many websites.


