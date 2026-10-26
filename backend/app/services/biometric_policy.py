"""Versioned biometric notice shown before consent is recorded.

Editing the wording requires a new POLICY_VERSION so stored consents keep pointing at the text
the participant actually agreed to.
"""

from dataclasses import dataclass

POLICY_VERSION = "1.0"
POLICY_TITLE = "Facial attendance enrolment notice"


@dataclass(frozen=True)
class PolicySection:
    heading: str
    body: str


SECTIONS: tuple[PolicySection, ...] = (
    PolicySection(
        "What we collect",
        "A small set of photographs of your face, taken while you look at the camera. The server "
        "computes a numerical face template from each photograph and checks that the pictures are "
        "clear, well lit and show one face.",
    ),
    PolicySection(
        "What we keep",
        "Only the encrypted numerical templates and a quality summary are stored. The photographs "
        "themselves are processed in memory and are not saved. The templates are encrypted with "
        "AES-256-GCM before they reach the database.",
    ),
    PolicySection(
        "Why we use it",
        "To confirm that the person in front of the classroom camera is enrolled for the session, "
        "so attendance can be recorded more quickly than a roll call. Templates are never used for "
        "surveillance, tracking between rooms, or any purpose outside attendance.",
    ),
    PolicySection(
        "Who can see it",
        "Templates are decrypted only inside the recognition service while an attendance session is "
        "running. They are never returned by the API, written to logs, or included in reports. "
        "Administrators can see whether you are enrolled and how many templates exist, not the "
        "templates themselves.",
    ),
    PolicySection(
        "Your choice",
        "Enrolment is voluntary. If you decline or withdraw, your attendance is recorded by the same "
        "roll-call and manual correction process used for every student. You can ask for your "
        "templates to be deleted from Privacy & biometrics at any time; deletion takes effect immediately.",
    ),
    PolicySection(
        "Limits of the system",
        "Face recognition can fail because of lighting, occlusion, camera quality or changes in "
        "appearance. The system never marks you present on an uncertain match: uncertain cases are "
        "queued for staff review, and you can raise a correction if a record is wrong.",
    ),
)
