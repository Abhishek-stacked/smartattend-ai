@ui @auth
Feature: Sign-in form
  As a faculty member or administrator
  I want the sign-in form to think before it sends my credentials
  so that I get an instant answer instead of a round trip I know will fail.

  Background:
    Given the sign-in page is open

  Scenario: Submit stays disabled until both credentials are entered
    Then the sign in button is disabled
    When I type the email "qa@nowhere-university.edu"
    Then the sign in button is disabled
    When I type the password "SomePassw0rd!"
    Then the sign in button is enabled

  Scenario: Password visibility can be toggled without losing what I typed
    When I type the password "SomePassw0rd!"
    Then the password field is masked
    When I show the password
    Then the password field is visible
    And the password field still holds "SomePassw0rd!"
    When I hide the password
    Then the password field is masked

  # Both rows use addresses that do not exist in the demo instance, so a shared
  # faculty account is never risked by a failing attempt and the sign-in rate
  # limit (10 per minute) is not approached.
  Scenario Outline: Invalid credentials are refused and my email is kept for the retry
    When I sign in as "<email>" with "<password>"
    Then I see the error "<error>"
    And the email field still holds "<email>"
    And I am still on the sign-in page

    Examples: rejected for <email>
      | email                         | password       | error                     |
      | nobody@nowhere-university.edu | WrongPassw0rd! | Invalid email or password |
      | qa@nowhere-university.edu     | Short1!        | Invalid email or password |
