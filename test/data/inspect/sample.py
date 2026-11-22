# A sample for the check with Inspect Editor Tokens and Scopes
import os
from dataclasses import dataclass

LIMIT = 42


@dataclass
class Circle:
    """A circle with a radius."""

    radius: float = 1.0

    def area(self) -> float:
        return 3.14159 * self.radius ** 2


def load(name: str, *args, **kwargs) -> list[str]:
    path = os.path.join(".", name)
    with open(path, encoding="utf8") as file:
        return [line for line in file if line.strip()]


if __name__ == "__main__" and LIMIT > 0:
    print(f"area: {Circle(2).area():.2f}", None, True)
    raise ValueError(r"\d+")
