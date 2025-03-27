"""
Credit to Tom Stuart https://github.com/rentalcustard for original code.

Updates by George Simmons https://github.com/GJHSimmons
- Updated to work with python 3
- Updated to work with modern Guardian format data
- Updated to scrape solutions and pass to puzpy

requires puzpy -> "pip install puzpy". Python 3+.

Credit to The Guardian for all puzzle content.

"""

import puz
from bs4 import BeautifulSoup
from urllib.request import urlopen
import re 
import os

crossword_type = "quiptic" # ["quick", "speedy", "quick-cryptic", "everyman", "quiptic", "cryptic", "prize"]
crossword_number = 1310

## Most crosswords are 15x15. Quick cryptic is 11x11.
width = 11 if (crossword_type == "quick-cryptic") else 15
height = 11 if (crossword_type == "quick-cryptic") else 15

solution = False if crossword_number in ["everyman", "prize"] else True 

accessible_url = f"https://www.theguardian.com/crosswords/accessible/{crossword_type}/{crossword_number}"

page = urlopen(accessible_url).read()
soup = BeautifulSoup(page, features='html.parser')

p = puz.Puzzle()
p.height = height
p.width = width
p.title = f"Guardian {crossword_type.title()}, Crossword No: {crossword_number}"
p.author = soup.find(attrs={"itemprop": "author"}).get_text()

across_clues_data = {}
down_clues_data = {}

class Clue:
    def __init__(self, number,  direction, text, solution):
        self.number = number
        self.direction = direction
        self.solution = solution
        self.text = text.encode('iso-8859-1', 'ignore').decode()

    def __lt__(self, other):
        if self.number == other.number:
            if self.direction == 'D':
                return False
            else:
                return True
        else:
            return self.number < other.number

clues = soup.find(attrs={"class": "crossword__clues"})

across_clues = clues.find(attrs={"class": "crossword__clues--across"}).find_all("li")
for clue in across_clues:
    location, text = clue.get_text().split(" ", 1)
    number = clue.get("value")
    clue = Clue(int(number), "A", text, "")
    across_clues_data[location] = clue
       
down_clues = clues.find(attrs={"class": "crossword__clues--down"}).find_all("li")
for clue in down_clues:
    location, text = clue.get_text().split(" ", 1)
    number = clue.get("value")
    clue = Clue(int(number), "D", text, "")
    down_clues_data[location] = clue

letter_to_number = {
            "A": 1,
            "B": 2,
            "C": 3,
            "D": 4,
            "E": 5,
            "F": 6,
            "G": 7,
            "H": 8,
            "I": 9,
            "J": 10,
            "K": 11,
            "L": 12,
            "M": 13,
            "N": 14,
            "O": 15
        }

list_fill = []
for row in soup.find_all(attrs={"class": "crossword__accessible-row-data"}):
    row_text = ["-"] * width
    for gap in row.get_text().split(": ")[1].split(" "):
        row_text[letter_to_number[gap] - 1] = "."
    list_fill.append(''.join(row_text))

fill = ''.join(list_fill)

all_clues = set(down_clues_data.values()) | set(across_clues_data.values())

sorted_clues = sorted(all_clues)

sorted_clue_text = [clue.text for clue in sorted_clues]

p.fill = fill
p.clues = sorted_clue_text

if solution:
    across_solutions = soup.find("table", attrs={"aria-label": "Across solutions"}).find_all("tr")
    for clue in across_solutions:
        try:
            location, text, solution = [data.get_text() for data in clue.find_all("td")]
            clue = across_clues_data[f"({location})"]
            clue.solution = solution
        except: 
            pass

    down_solutions = soup.find("table", attrs={"aria-label": "Down solutions"}).find_all("tr")
    for clue in down_solutions:
        try:
            location, text, solution = [data.get_text() for data in clue.find_all("td")]
            clue = down_clues_data[f"({location})"]
            clue.solution = solution
        except: 
            pass

    sol_grid = list_fill
    for clue, object in across_clues_data.items():
        solution = object.solution
        clue = clue[1:-1]
        _, row, col = re.split('(\d+)',clue)
        row = int(row)
        col = int(letter_to_number[col])
        edit_row = list(sol_grid[row-1])
        for i, letter in enumerate(solution):
            edit_row[col+i-1] = letter
        sol_grid[row-1] = "".join(edit_row)

    for clue, object in down_clues_data.items():
        solution = object.solution
        clue = clue[1:-1]
        _, row, col = re.split('(\d+)',clue)
        row = int(row)
        col = int(letter_to_number[col])
        for i, letter in enumerate(solution):
            edit_row = list(sol_grid[row+i-1])
            edit_row[col-1] = letter
            sol_grid[row+i-1] = "".join(edit_row)

    sol = "".join(sol_grid)

    p.solution = sol


output_name = f"Guardian_{crossword_type}_{crossword_number}.puz" 
cwd_name = os.getcwd()
dir_name = os.path.join(cwd_name, "outputs", crossword_type)

try:
    os.makedirs(dir_name)
except FileExistsError:
    pass
except PermissionError:
    print(f"Permission denied: Unable to create '{dir_name}'.")
except Exception as e:
    print(f"An error occurred: {e}")

file_name = os.path.join(dir_name, output_name)

p.save(file_name)

    
    