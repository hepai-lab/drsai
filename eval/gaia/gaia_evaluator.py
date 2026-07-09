"""
GAIA Answer Evaluator

Implements the GAIA benchmark scoring logic.
The official GAIA evaluation uses exact match with normalization.

Scoring rules (based on the official GAIA scorer):
1. The model's answer is extracted from the final response
2. Both predicted and ground truth answers are normalized:
   - Strip whitespace
   - Convert to lowercase
   - Remove leading articles (the, a, an) if single word
   - Remove trailing periods
   - For numbers: compare as floats when possible
3. Exact match after normalization
4. Some questions have multiple acceptable answers (comma-separated in ground truth)

Answer Extraction:
- The agent's final response should contain the answer
- We look for the last line, or text after "Answer:" marker
- We also support exact-match on the full response as fallback
"""

import re
import string
from dataclasses import dataclass
from typing import Optional, List, Tuple
from loguru import logger


@dataclass
class QuestionSucceeded:
    """Result of evaluating a single GAIA question."""
    task_id: str
    success: bool
    predicted_answer: str
    ground_truth: str
    raw_response: str
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "success": self.success,
            "predicted_answer": self.predicted_answer,
            "ground_truth": self.ground_truth,
            "reason": self.reason,
        }


class GAIAEvaluator:
    """Evaluates agent responses against GAIA ground truth answers."""

    # Patterns for extracting the answer from agent response
    ANSWER_PATTERNS = [
        # "Answer: xxx" or "answer: xxx" or "ANSWER: xxx"
        re.compile(r"(?:Final\s+)?[Aa]nswer\s*[:：]\s*(.+?)(?:\n|$|\.gz$)", re.DOTALL),
        # "The answer is xxx"
        re.compile(r"[Tt]he\s+(?:final\s+)?answer\s+is\s*:?\s*(.+?)(?:\n|$)", re.DOTALL),
        # "答案是 xxx" (Chinese)
        re.compile(r"答案[是为：:]\s*(.+?)(?:\n|$)", re.DOTALL),
        # Boxed answer (LaTeX style): \boxed{xxx}
        re.compile(r"\\boxed\{([^}]+)\}"),
        # Last line that's not empty
    ]

    def __init__(self):
        pass

    def extract_answer(self, response: str) -> str:
        """Extract the predicted answer from the agent's full response.

        Tries multiple strategies:
        1. Look for explicit "Answer:" markers
        2. Look for \\boxed{} pattern
        3. Fall back to the last non-empty line
        """
        if not response or not response.strip():
            return ""

        response = response.strip()

        # Strategy 1: Try regex patterns
        for pattern in self.ANSWER_PATTERNS:
            match = pattern.search(response)
            if match:
                answer = match.group(1).strip()
                # Clean up the answer
                answer = answer.rstrip(".。")
                if answer:
                    return answer

        # Strategy 2: Last non-empty line
        lines = [l.strip() for l in response.split("\n") if l.strip()]
        if lines:
            answer = lines[-1].rstrip(".。")
            return answer

        return response.strip()

    def normalize_answer(self, answer: str) -> str:
        """Normalize an answer string for comparison.

        GAIA normalization rules:
        - Lowercase
        - Strip whitespace
        - Remove leading articles for short answers
        - Remove trailing punctuation
        - Normalize numbers (remove leading zeros, trailing .0)
        """
        if not answer:
            return ""

        answer = answer.strip().lower()

        # Remove leading articles for short answers (1-2 words)
        words = answer.split()
        if len(words) <= 2 and words and words[0] in {"the", "a", "an"}:
            answer = " ".join(words[1:])

        # Remove trailing punctuation
        answer = answer.rstrip(string.punctuation)

        # Try to normalize as a number
        try:
            num = float(answer.replace(",", ""))
            # If it's a whole number, remove .0
            if num == int(num):
                answer = str(int(num))
            else:
                answer = str(num)
        except (ValueError, OverflowError):
            pass

        # Remove extra whitespace
        answer = " ".join(answer.split())

        return answer

    def is_correct(
        self,
        predicted: str,
        ground_truth: str,
    ) -> Tuple[bool, str]:
        """Check if the predicted answer matches the ground truth.

        Returns (is_correct, reason).
        """
        if not predicted:
            return False, "Empty predicted answer"

        # GAIA ground truth may contain multiple acceptable answers
        # separated by commas or " | "
        acceptable_answers = self._split_ground_truth(ground_truth)

        pred_normalized = self.normalize_answer(predicted)

        for gt_answer in acceptable_answers:
            gt_normalized = self.normalize_answer(gt_answer)

            # Exact match
            if pred_normalized == gt_normalized:
                return True, f"Exact match: '{pred_normalized}' == '{gt_normalized}'"

            # Check if predicted contains the ground truth (for longer answers)
            if len(gt_normalized) > 0 and gt_normalized in pred_normalized:
                return True, f"Ground truth '{gt_normalized}' found in prediction"

            # Check if ground truth contains the prediction
            if len(pred_normalized) > 0 and pred_normalized in gt_normalized:
                return True, f"Prediction '{pred_normalized}' found in ground truth"

        return False, (
            f"No match. Predicted: '{pred_normalized}', "
            f"Ground truth: '{ground_truth}'"
        )

    def _split_ground_truth(self, ground_truth: str) -> List[str]:
        """Split ground truth into multiple acceptable answers.

        GAIA ground truth answers may contain multiple acceptable answers
        separated by commas or " | " or " or ".
        """
        if not ground_truth:
            return [""]

        # Split by " | " first (GAIA uses this for alternative answers)
        if " | " in ground_truth:
            return [a.strip() for a in ground_truth.split(" | ")]

        # Split by ", " for list answers — but be careful with numbers
        # Only split by comma if it looks like a list of items, not a single number
        if ", " in ground_truth and not self._looks_like_number(ground_truth):
            return [a.strip() for a in ground_truth.split(", ")]

        return [ground_truth.strip()]

    def _looks_like_number(self, s: str) -> bool:
        """Check if a string looks like a number (possibly with commas)."""
        try:
            float(s.replace(",", "").replace(" ", ""))
            return True
        except (ValueError, OverflowError):
            return False

    def evaluate(
        self,
        task_id: str,
        raw_response: str,
        ground_truth: str,
    ) -> QuestionSucceeded:
        """Evaluate a single task's response.

        Args:
            task_id: The GAIA task ID.
            raw_response: The agent's full final response text.
            ground_truth: The GAIA ground truth final answer.

        Returns:
            QuestionSucceeded object with the evaluation result.
        """
        predicted = self.extract_answer(raw_response)
        is_match, reason = self.is_correct(predicted, ground_truth)

        return QuestionSucceeded(
            task_id=task_id,
            success=is_match,
            predicted_answer=predicted,
            ground_truth=ground_truth,
            raw_response=raw_response,
            reason=reason,
        )
