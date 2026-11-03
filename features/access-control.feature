@ui @access-control
Feature: Access control
  As the operator of SmartAttend AI
  I want visitors who are not signed in, and signed-in users who reach above
  their role, to be turned away
  so that student records stay out of reach of the wrong eyes.

  Scenario Outline: A visitor without a session is bounced from the administrator register
    When I open "<path>" without a session
    Then I am redirected to the sign-in page
    And the sign in form is offered

    Examples: visitors are turned away at <path>
      | path         |
      | /students    |
      | /faculty     |
      | /admin/users |

  Scenario: A visitor without a session cannot read protected API data
    When I call the protected endpoint "/api/faculty/1" without a session
    Then the API responds with status 401
    And the API error code is "unauthenticated"

  # These two journeys need a real non-administrator account. The steps call
  # test.skip() when E2E_EMAIL / E2E_PASSWORD are unset, so the suite stays
  # green on a fork or a pull request where no credentials exist — the same
  # contract the Playwright specs keep.
  @requires-faculty-credentials
  Scenario Outline: A signed-in non-administrator is sent away from the administrator register
    Given I am signed in with the faculty credentials from the environment
    When I open "<path>"
    Then I am redirected to the unauthorized page
    And I see the access denied message

    Examples: <path> is closed to a faculty session
      | path         |
      | /students    |
      | /faculty     |
      | /admin/users |

  @requires-faculty-credentials
  Scenario: A signed-in faculty member reaches their own sessions and filters them
    Given I am signed in with the faculty credentials from the environment
    When I open the attendance sessions screen
    Then at least one session row is listed
    When I filter the sessions by "no-session-matches-this-title"
    Then the sessions empty state is shown
