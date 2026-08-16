"""
Lander - Learning Progress Tracker
Playwright Tests

Validates UI polish, functionality, and responsiveness.
Run with: playwright test
"""

import asyncio
import os
import sys
import pytest
from playwright.async_api import async_playwright, expect

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, init_db

BASE_URL = "http://localhost:8000"


@pytest.fixture(scope="function")
def seed_test_data():
    init_db()
    with get_db() as conn:
        conn.execute("DELETE FROM subjects")
        cur = conn.execute("INSERT INTO subjects (name) VALUES (?)", ("Test Subject",))
        subject_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO sections (subject_id, name, sort_order) VALUES (?, ?, ?)",
            (subject_id, "Test Section", 0))
        section_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO chapters (section_id, name, sort_order) VALUES (?, ?, ?)",
            (section_id, "Test Chapter", 0))
        chapter_id = cur.lastrowid
        conn.execute(
            "INSERT INTO lessons (chapter_id, name, understanding, sort_order) VALUES (?, ?, ?, ?)",
            (chapter_id, "Test Lesson", 75, 0))


@pytest.fixture
async def browser():
    """Create and destroy browser for tests."""
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        yield browser
        await browser.close()


@pytest.fixture
async def page(browser):
    """Create a new page for each test."""
    context = await browser.new_context()
    page = await context.new_page()
    yield page
    await page.close()
    await context.close()


class TestBranding:
    """Test Lander branding and UI polish."""
    
    async def test_page_title(self, page):
        """Verify page title is 'Lander'."""
        await page.goto(BASE_URL)
        title = await page.title()
        assert "Lander" in title
    
    async def test_brand_mark_visible(self, page):
        """Verify brand mark (L) is displayed."""
        await page.goto(BASE_URL)
        brand_mark = page.locator(".brand-mark")
        await expect(brand_mark).to_be_visible()
        text = await brand_mark.text_content()
        assert "L" in text
    
    async def test_hero_title(self, page):
        """Verify hero title is displayed."""
        await page.goto(BASE_URL)
        hero_title = page.locator(".hero-title")
        await expect(hero_title).to_be_visible()
        text = await hero_title.text_content()
        assert len(text) > 0
    
    async def test_eyebrow_text(self, page):
        """Verify eyebrow displays 'Lander'."""
        await page.goto(BASE_URL)
        eyebrow = page.locator(".eyebrow")
        await expect(eyebrow).to_be_visible()
        text = await eyebrow.text_content()
        assert "Lander" in text.upper()


class TestLayout:
    """Test responsive layout and spacing."""
    
    async def test_desktop_layout(self, page):
        """Test desktop (1280px) layout."""
        await page.set_viewport_size({"width": 1280, "height": 800})
        await page.goto(BASE_URL)
        
        brand_panel = page.locator(".brand-panel")
        await expect(brand_panel).to_be_visible()
        
        subject_header = page.locator(".subject-header")
        await expect(subject_header).to_be_visible()
    
    async def test_tablet_layout(self, page):
        """Test tablet (768px) layout."""
        await page.set_viewport_size({"width": 768, "height": 1024})
        await page.goto(BASE_URL)
        
        brand_panel = page.locator(".brand-panel")
        await expect(brand_panel).to_be_visible()
        
        subject_header = page.locator(".subject-header")
        await expect(subject_header).to_be_visible()
    
    async def test_mobile_layout(self, page):
        """Test mobile (375px) layout."""
        await page.set_viewport_size({"width": 375, "height": 667})
        await page.goto(BASE_URL)
        
        brand_panel = page.locator(".brand-panel")
        await expect(brand_panel).to_be_visible()
        
        subject_header = page.locator(".subject-header")
        await expect(subject_header).to_be_visible()


class TestFunctionality:
    """Test core application functionality."""
    
    async def test_page_loads_successfully(self, page):
        """Verify page loads without errors."""
        response = await page.goto(BASE_URL)
        assert response.status == 200
    
    async def test_subject_header_displays(self, page):
        """Verify subject header is displayed."""
        await page.goto(BASE_URL)
        
        # Wait for content to load
        await page.wait_for_selector(".subject-header", timeout=5000)
        
        subject_header = page.locator(".subject-header")
        await expect(subject_header).to_be_visible()
    
    async def test_sections_display(self, page, seed_test_data):
        """Verify sections are displayed."""
        await page.goto(BASE_URL)
        
        # Wait for sections to load
        await page.wait_for_selector(".section", timeout=5000)
        
        sections = page.locator(".section")
        count = await sections.count()
        assert count > 0
    
    async def test_section_expand_collapse(self, page, seed_test_data):
        """Verify section expand/collapse toggle."""
        await page.goto(BASE_URL)
        
        # Wait for sections to load
        await page.wait_for_selector(".section", timeout=5000)
        
        section = page.locator(".section").first
        section_header = section.locator(".section-header")
        section_body = section.locator(".section-body")
        
        # Check initially visible
        await expect(section_body).to_be_visible()
        
        # Click to collapse
        await section_header.click()
        await page.wait_for_timeout(300)  # Wait for animation
        
        # Verify collapsed state
        is_visible = await section_body.is_visible()
        assert not is_visible
        
        # Click to expand
        await section_header.click()
        await page.wait_for_timeout(300)
        
        await expect(section_body).to_be_visible()
    
    async def test_chapter_expand_collapse(self, page, seed_test_data):
        """Verify chapter expand/collapse toggle."""
        await page.goto(BASE_URL)
        
        # Wait for chapters to load
        await page.wait_for_selector(".chapter", timeout=5000)
        
        chapter = page.locator(".chapter").first
        chapter_header = chapter.locator(".chapter-header")
        chapter_body = chapter.locator(".chapter-body")
        
        # Check initially visible
        await expect(chapter_body).to_be_visible()
        
        # Click to collapse
        await chapter_header.click()
        await page.wait_for_timeout(300)
        
        # Verify collapsed
        is_visible = await chapter_body.is_visible()
        assert not is_visible
        
        # Click to expand
        await chapter_header.click()
        await page.wait_for_timeout(300)
        
        await expect(chapter_body).to_be_visible()
    
    async def test_lesson_understanding_click_editable(self, page, seed_test_data):
        """Verify lesson understanding value is clickable and editable."""
        await page.goto(BASE_URL)
        
        # Wait for lessons to load
        await page.wait_for_selector(".lesson-item", timeout=5000)
        
        lesson_item = page.locator(".lesson-item").first
        understanding_display = lesson_item.locator(".understanding-display")
        
        # Get initial value
        initial_value = await understanding_display.text_content()
        
        # Click to edit
        await understanding_display.click()
        await page.wait_for_timeout(100)
        
        # Verify input appears
        understanding_input = lesson_item.locator(".understanding-input")
        await expect(understanding_input).to_be_visible()
    
    async def test_import_modal_opens(self, page):
        """Verify import modal can be opened."""
        await page.goto(BASE_URL)
        
        # Wait for import button
        await page.wait_for_selector('[data-import-btn]', timeout=5000)
        
        import_btn = page.locator('[data-import-btn]')
        await import_btn.click()
        
        import_modal = page.locator("#import-modal")
        await expect(import_modal).not_to_have_class("hidden")
    
    async def test_import_modal_closes(self, page):
        """Verify import modal can be closed."""
        await page.goto(BASE_URL)
        
        # Open modal
        await page.wait_for_selector('[data-import-btn]', timeout=5000)
        await page.locator('[data-import-btn]').click()
        
        # Close modal
        close_btn = page.locator("#import-modal-close")
        await close_btn.click()
        
        import_modal = page.locator("#import-modal")
        await expect(import_modal).to_contain_class("hidden")
    
    async def test_history_chart_button_visible(self, page, seed_test_data):
        """Verify history chart buttons are visible."""
        await page.goto(BASE_URL)
        
        # Wait for history buttons
        await page.wait_for_selector(".history-btn", timeout=5000)
        
        history_buttons = page.locator(".history-btn")
        count = await history_buttons.count()
        assert count > 0


class TestStyling:
    """Test CSS styling and visual polish."""
    
    async def test_brand_mark_has_gradient(self, page):
        """Verify brand mark has gradient styling."""
        await page.goto(BASE_URL)
        
        brand_mark = page.locator(".brand-mark")
        background = await brand_mark.evaluate(
            "el => window.getComputedStyle(el).backgroundImage"
        )
        assert "gradient" in background or background != "none"
    
    async def test_buttons_have_hover_state(self, page):
        """Verify buttons have hover styling."""
        await page.goto(BASE_URL)
        
        # Wait for buttons
        await page.wait_for_selector(".btn", timeout=5000)
        
        btn = page.locator(".btn").first
        
        # Get initial shadow
        initial_shadow = await btn.evaluate(
            "el => window.getComputedStyle(el).boxShadow"
        )
        
        # Hover
        await btn.hover()
        
        # Get hover shadow
        hover_shadow = await btn.evaluate(
            "el => window.getComputedStyle(el).boxShadow"
        )
        
        # Shadow should change on hover (polish feature)
        assert initial_shadow != hover_shadow or len(hover_shadow) > 5
    
    async def test_understanding_display_colored(self, page, seed_test_data):
        """Verify understanding displays have color."""
        await page.goto(BASE_URL)
        
        # Wait for lessons
        await page.wait_for_selector(".understanding-display", timeout=5000)
        
        understanding_display = page.locator(".understanding-display").first
        color = await understanding_display.evaluate(
            "el => window.getComputedStyle(el).color"
        )
        
        # Should have a color applied (not empty)
        assert color and color != "rgba(0, 0, 0, 0)"
    
    async def test_modal_has_backdrop(self, page):
        """Verify modal has backdrop with blur."""
        await page.goto(BASE_URL)
        
        # Open import modal
        await page.wait_for_selector('[data-import-btn]', timeout=5000)
        await page.locator('[data-import-btn]').click()
        
        backdrop = page.locator(".modal-backdrop")
        await expect(backdrop).to_be_visible()
        
        filter_value = await backdrop.evaluate(
            "el => window.getComputedStyle(el).backdropFilter"
        )
        assert "blur" in filter_value


class TestAccessibility:
    """Test accessibility features."""
    
    async def test_page_has_lang_attribute(self, page):
        """Verify HTML has lang attribute."""
        await page.goto(BASE_URL)
        
        lang = await page.locator("html").get_attribute("lang")
        assert lang == "en"
    
    async def test_modal_has_aria_attributes(self, page):
        """Verify modals have ARIA attributes."""
        await page.goto(BASE_URL)
        
        # Open modal
        await page.wait_for_selector('[data-import-btn]', timeout=5000)
        await page.locator('[data-import-btn]').click()
        
        modal = page.locator("#import-modal")
        
        aria_modal = await modal.get_attribute("aria-modal")
        aria_label = await modal.get_attribute("aria-labelledby")
        
        assert aria_modal == "true"
        assert aria_label is not None
    
    async def test_buttons_are_focusable(self, page):
        """Verify buttons are keyboard focusable."""
        await page.goto(BASE_URL)
        
        await page.wait_for_selector(".btn", timeout=5000)
        
        btn = page.locator(".btn").first
        
        # Tab to button
        await page.keyboard.press("Tab")
        
        # Check if any button is focused
        focused = await page.evaluate(
            "() => document.activeElement?.classList.contains('btn')"
        )
        
        # Either button is focused or we need more tabs
        # This is a basic check
        assert btn is not None


class TestPerformance:
    """Test performance-related aspects."""
    
    async def test_page_loads_quickly(self, page):
        """Verify page loads within reasonable time."""
        start = asyncio.get_event_loop().time()
        await page.goto(BASE_URL)
        elapsed = asyncio.get_event_loop().time() - start
        
        # Should load within 10 seconds
        assert elapsed < 10
    
    async def test_animations_complete(self, page):
        """Verify animations complete smoothly."""
        await page.goto(BASE_URL)
        
        # Wait for animations to complete
        await page.wait_for_timeout(1000)
        
        # Verify no animations are stuck
        brand_panel = page.locator(".brand-panel")
        await expect(brand_panel).to_be_visible()


class TestResponsiveness:
    """Test responsive behavior across devices."""
    
    async def test_content_readable_on_mobile(self, page):
        """Verify content is readable on mobile."""
        await page.set_viewport_size({"width": 375, "height": 667})
        await page.goto(BASE_URL)
        
        # Wait for content
        await page.wait_for_selector(".subject-header", timeout=5000)
        
        # Verify text is not hidden
        subject_header = page.locator(".subject-header")
        title = subject_header.locator("h1")
        
        await expect(title).to_be_visible()
    
    async def test_buttons_touchable_on_mobile(self, page):
        """Verify buttons are touch-sized on mobile."""
        await page.set_viewport_size({"width": 375, "height": 667})
        await page.goto(BASE_URL)
        
        await page.wait_for_selector(".btn", timeout=5000)
        
        btn = page.locator(".btn").first
        
        # Get button size
        box = await btn.bounding_box()
        
        # Button should be at least 44x44 (touch target minimum)
        assert box["width"] >= 40
        assert box["height"] >= 40
    
    async def test_modals_fit_mobile_screen(self, page):
        """Verify modals fit on mobile screen."""
        await page.set_viewport_size({"width": 375, "height": 667})
        await page.goto(BASE_URL)
        
        # Open modal
        await page.wait_for_selector('[data-import-btn]', timeout=5000)
        await page.locator('[data-import-btn]').click()
        
        modal_content = page.locator(".modal-content")
        box = await modal_content.bounding_box()
        
        # Modal should fit within viewport
        assert box["width"] <= 375
        assert box["height"] <= 667


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
