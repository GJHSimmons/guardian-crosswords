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

LETTER_TO_NUMBER = {
    "A": 1, "B": 2, "C": 3, "D": 4, "E": 5,
    "F": 6, "G": 7, "H": 8, "I": 9, "J": 10,
    "K": 11, "L": 12, "M": 13, "N": 14, "O": 15
}


def _parse_location(location_str):
    """Parse a location string like '2A' into (row, col) 0-indexed."""
    _, row, col = re.split(r'(\d+)', location_str)
    return int(row) - 1, LETTER_TO_NUMBER[col] - 1


def _scrape(crossword_type, crossword_number):
    """Scrape a Guardian crossword accessible page and return raw parsed data."""
    width = 11 if crossword_type == "quick-cryptic" else 15
    height = 11 if crossword_type == "quick-cryptic" else 15
    has_solution = crossword_type not in ["everyman", "prize"]

    url = f"https://www.theguardian.com/crosswords/accessible/{crossword_type}/{crossword_number}"
    soup = BeautifulSoup(urlopen(url).read(), features='html.parser')

    class Clue:
        def __init__(self, number, direction, text, solution=""):
            self.number = number
            self.direction = direction
            self.solution = solution
            self.text = text  # keep raw Unicode; encode only when writing .puz

        def __lt__(self, other):
            if self.number == other.number:
                return self.direction != 'D'
            return self.number < other.number

    clues_div = soup.find(attrs={"class": "crossword__clues"})
    across_clues_data = {}
    down_clues_data = {}

    for li in clues_div.find(attrs={"class": "crossword__clues--across"}).find_all("li"):
        location, text = li.get_text().split(" ", 1)
        across_clues_data[location] = Clue(int(li.get("value")), "A", text)

    for li in clues_div.find(attrs={"class": "crossword__clues--down"}).find_all("li"):
        location, text = li.get_text().split(" ", 1)
        down_clues_data[location] = Clue(int(li.get("value")), "D", text)

    list_fill = []
    for row in soup.find_all(attrs={"class": "crossword__accessible-row-data"}):
        row_text = ["-"] * width
        for gap in row.get_text().split(": ")[1].split(" "):
            if gap and gap in LETTER_TO_NUMBER:
                row_text[LETTER_TO_NUMBER[gap] - 1] = "."
        list_fill.append(''.join(row_text))

    if has_solution:
        for tr in soup.find("table", attrs={"aria-label": "Across solutions"}).find_all("tr"):
            try:
                location, _, solution = [td.get_text() for td in tr.find_all("td")]
                across_clues_data[f"({location})"].solution = solution
            except Exception:
                pass

        for tr in soup.find("table", attrs={"aria-label": "Down solutions"}).find_all("tr"):
            try:
                location, _, solution = [td.get_text() for td in tr.find_all("td")]
                down_clues_data[f"({location})"].solution = solution
            except Exception:
                pass

    return {
        "width": width,
        "height": height,
        "has_solution": has_solution,
        "title": f"Guardian {crossword_type.title()}, No {crossword_number}",
        "author": soup.find(attrs={"itemprop": "author"}).get_text(strip=True),
        "across": across_clues_data,
        "down": down_clues_data,
        "fill": list_fill,
    }


def get_crossword_data(crossword_type, crossword_number):
    """Return crossword data in @jaredreisinger/react-crossword format."""
    data = _scrape(crossword_type, crossword_number)

    across = {}
    for location, clue in data["across"].items():
        loc = location[1:-1]  # strip parens
        row, col = _parse_location(loc)
        across[str(clue.number)] = {
            "clue": clue.text,
            "answer": clue.solution,
            "row": row,
            "col": col,
        }

    down = {}
    for location, clue in data["down"].items():
        loc = location[1:-1]
        row, col = _parse_location(loc)
        down[str(clue.number)] = {
            "clue": clue.text,
            "answer": clue.solution,
            "row": row,
            "col": col,
        }

    return {
        "title": data["title"],
        "author": data["author"],
        "across": across,
        "down": down,
        "width": data["width"],
        "height": data["height"],
    }


class Crossword:

    def __init__(self, type, number, path):
        data = _scrape(type, number)

        p = puz.Puzzle()
        p.height = data["height"]
        p.width = data["width"]
        p.title = data["title"]
        p.author = data["author"]

        all_clues = sorted(
            list(data["across"].values()) + list(data["down"].values())
        )
        p.fill = ''.join(data["fill"])
        p.clues = [clue.text.encode('iso-8859-1', 'replace').decode('iso-8859-1') for clue in all_clues]

        if data["has_solution"]:
            sol_grid = list(data["fill"])

            for location, clue_obj in data["across"].items():
                loc = location[1:-1]
                row, col = _parse_location(loc)
                edit_row = list(sol_grid[row])
                for i, letter in enumerate(clue_obj.solution):
                    edit_row[col + i] = letter
                sol_grid[row] = "".join(edit_row)

            for location, clue_obj in data["down"].items():
                loc = location[1:-1]
                row, col = _parse_location(loc)
                for i, letter in enumerate(clue_obj.solution):
                    edit_row = list(sol_grid[row + i])
                    edit_row[col] = letter
                    sol_grid[row + i] = "".join(edit_row)

            p.solution = "".join(sol_grid)

        print("saving", path)
        p.save(path)


if __name__ == "__main__":
    crossword_type = "quiptic"
    crossword_number = 1320

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    OUTPUT_DIR = os.path.join(BASE_DIR, "output_files")
    puzzle_dir = os.path.join(OUTPUT_DIR, crossword_type)
    os.makedirs(puzzle_dir, exist_ok=True)
    filename = os.path.join(puzzle_dir, f"Guardian_{crossword_type}_{crossword_number}.puz")

    Crossword(crossword_type, crossword_number, filename)
