document.addEventListener('DOMContentLoaded', function() {
    // --- Skeleton Preloader Logic ---
    const containersWithLoaders = document.querySelectorAll('.content-wrapper, .container, .my-5');

    containersWithLoaders.forEach(container => {
        const skeletonLoader = container.querySelector(':scope > .skeleton-loader');
        const contentToLoad = container.querySelector(':scope > .content-to-load');
        
        if (skeletonLoader && contentToLoad) {
            container.classList.add('is-loading');
            setTimeout(() => {
                container.classList.remove('is-loading');
            }, 100);
        }
    });

    // --- Location Data for Mini-Cart ---
    const locationData = JSON.parse(document.body.dataset.location || '{}');

    // --- Desktop Navbar Dropdown Logic (UPDATED) ---
    const desktopNavLinks = document.querySelectorAll(".navbar-desktop .list-menu, #desktop-search-btn");
    const dropdownContainer = document.querySelector(".dropdown");
    const contentPanels = document.querySelectorAll(".dropdown .con-1");

    if (desktopNavLinks.length > 0 && dropdownContainer) {
        const closeDropdown = () => {
            dropdownContainer.style.height = "0px";
            contentPanels.forEach(panel => {
                panel.style.opacity = "0";
                panel.style.pointerEvents = "none"; // Make invisible panels non-interactive
            });
        };
        const openDropdown = (activeIndex) => {
            dropdownContainer.style.height = "280px";
            contentPanels.forEach((panel, index) => {
                if (index === activeIndex) {
                    panel.style.opacity = "1";
                    panel.style.pointerEvents = "auto"; // Make the active panel interactive
                } else {
                    panel.style.opacity = "0";
                    panel.style.pointerEvents = "none"; // Make all other panels non-interactive
                }
            });
        };

        desktopNavLinks.forEach(link => {
            const panelIndex = parseInt(link.dataset.panel, 10);
            if (!isNaN(panelIndex)) {
                const eventType = link.id === 'desktop-search-btn' ? 'click' : 'mouseover';
                link.addEventListener(eventType, (e) => {
                    if(e.type === 'click') e.preventDefault();
                    const isAlreadyOpen = dropdownContainer.style.height === "280px" && contentPanels[panelIndex].style.opacity === "1";
                    if (e.type === 'click' && isAlreadyOpen) {
                        closeDropdown();
                    } else {
                        openDropdown(panelIndex);
                    }
                });
            }
        });

        dropdownContainer.addEventListener("mouseleave", closeDropdown);
    }

    // --- Desktop User Dropdown Menu Logic ---
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');
    if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', (event) => {
            event.preventDefault();
            userDropdown.classList.toggle('is-active');
        });
        window.addEventListener('click', (event) => {
            if (!userMenuBtn.contains(event.target) && !userDropdown.contains(event.target)) {
                userDropdown.classList.remove('is-active');
            }
        });
    }

    // --- Mobile Overlay Logic ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileSearchBtn = document.getElementById('mobile-search-btn');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const searchOverlay = document.querySelector('.overlay#search-overlay');
    const mobileMenuCloseBtn = document.getElementById('mobile-menu-close-btn');
    const searchOverlayCloseBtn = document.getElementById('search-overlay-close-btn');
    const body = document.body;
    const openOverlay = (overlay) => {
        if (overlay) {
            overlay.classList.add('is-active');
            body.style.overflow = 'hidden';
        }
    };
    const closeAllOverlays = () => {
        document.querySelectorAll('.overlay.is-active').forEach(overlay => {
            overlay.classList.remove('is-active');
        });
        body.style.overflow = '';
    };
    if (mobileMenuBtn) { mobileMenuBtn.addEventListener('click', (e) => { e.preventDefault(); openOverlay(mobileMenuOverlay); }); }
    if (mobileSearchBtn) { mobileSearchBtn.addEventListener('click', (e) => { e.preventDefault(); openOverlay(searchOverlay); }); }
    if (mobileMenuCloseBtn) { mobileMenuCloseBtn.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); }); }
    if (searchOverlayCloseBtn) { searchOverlayCloseBtn.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); }); }

    // --- Product Carousel Navigation Logic ---
    const carouselSections = document.querySelectorAll('.product-carousel-section');
    carouselSections.forEach(section => {
        const carousel = section.querySelector('.product-carousel');
        const prevBtn = section.querySelector('.carousel-nav-btn.prev');
        const nextBtn = section.querySelector('.carousel-nav-btn.next');

        if (carousel && prevBtn && nextBtn) {
            nextBtn.addEventListener('click', () => {
                const firstCard = carousel.querySelector('.product-card');
                if (firstCard) {
                    const scrollAmount = firstCard.offsetWidth + 24; // Card width + gap
                    carousel.scrollLeft += scrollAmount;
                }
            });

            prevBtn.addEventListener('click', () => {
                const firstCard = carousel.querySelector('.product-card');
                if (firstCard) {
                    const scrollAmount = firstCard.offsetWidth + 24; // Card width + gap
                    carousel.scrollLeft -= scrollAmount;
                }
            });
        }
    });

    // --- Global Wishlist Toggle Logic ---
    document.body.addEventListener('click', function(event) {
        const wishlistBtn = event.target.closest('.wishlist-toggle-btn');
        if (wishlistBtn) {
            const productId = wishlistBtn.dataset.productId;
            const icon = wishlistBtn.querySelector('i');

            fetch('/account/wishlist/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: productId })
            })
            .then(response => {
                if (!response.ok) {
                    if (response.status === 401 || response.redirected) {
                        window.location.href = '/users/login';
                        return;
                    }
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data && data.success) {
                    if (data.newStatus === 'added') {
                        icon.classList.remove('bi-heart');
                        icon.classList.add('bi-heart-fill');
                    } else {
                        icon.classList.remove('bi-heart-fill');
                        icon.classList.add('bi-heart');
                    }
                }
            })
            .catch(error => {
                console.error('Wishlist toggle error:', error);
            });
        }
    });


    // --- Admin Product Page Logic ---
    if (document.getElementById('nav-tabContent')) {

        // --- Import Tab Logic ---
        const importForm = document.getElementById('multi-import-form');
        if (importForm) {
            const resultsContainer = document.getElementById('results-container');
            const importActionBar = document.getElementById('import-action-bar');
            const selectedImportCountSpan = document.getElementById('selected-import-count');
            const searchForm = document.getElementById('search-form');

            const updateImportSelectionState = () => {
                const selectedCheckboxes = resultsContainer.querySelectorAll('.product-checkbox:checked');
                const count = selectedCheckboxes.length;
                selectedImportCountSpan.textContent = count;
                importActionBar.classList.toggle('is-active', count > 0);
            };

            resultsContainer.addEventListener('click', function(event) {
                const card = event.target.closest('.product-import-card');
                if (!card) return;
                const checkbox = card.querySelector('.product-checkbox');
                if (checkbox) {
                    if (event.target.tagName !== 'INPUT') {
                        checkbox.checked = !checkbox.checked;
                    }
                    card.classList.toggle('is-selected', checkbox.checked);
                    updateImportSelectionState();
                }
            });

            if (searchForm) {
                const searchButton = document.getElementById('search-button');
                searchForm.addEventListener('submit', async function(event) {
                    event.preventDefault();
                    resultsContainer.innerHTML = '';
                    searchButton.disabled = true;
                    updateImportSelectionState();
                    try {
                        const formData = new FormData(searchForm);
                        const response = await fetch('/products/search', {
                            method: 'POST',
                            body: new URLSearchParams(formData)
                        });
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        const html = await response.text();
                        resultsContainer.innerHTML = html;
                    } catch (error) {
                        console.error('Search failed:', error);
                        resultsContainer.innerHTML = `<div class="col-12 mt-4"><div class="text-center p-5 dashboard-card"><p class="h4 text-body-secondary">Search failed. Please try again.</p></div></div>`;
                    } finally {
                        searchButton.disabled = false;
                        updateImportSelectionState();
                    }
                });
            }
            updateImportSelectionState();
        }

        // --- Inventory Tab Logic (Simplified) ---
        const inventoryTable = document.getElementById('inventory-table');
        if (inventoryTable) {
            const selectAllCheckbox = document.getElementById('select-all-inventory');
            const tableBody = inventoryTable.querySelector('tbody');
            const deleteActionBar = document.getElementById('delete-action-bar');
            const selectedDeleteCountSpan = document.getElementById('selected-delete-count');
            
            const updateDeleteSelectionState = () => {
                const checkedCount = tableBody.querySelectorAll('.inventory-checkbox:checked').length;
                selectedDeleteCountSpan.textContent = checkedCount;
                deleteActionBar.classList.toggle('is-active', checkedCount > 0);
                const allCheckboxes = tableBody.querySelectorAll('.inventory-checkbox');
                if (selectAllCheckbox) {
                    selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
                }
            };

            if (selectAllCheckbox) {
                selectAllCheckbox.addEventListener('change', () => {
                    tableBody.querySelectorAll('.inventory-checkbox').forEach(checkbox => {
                        checkbox.checked = selectAllCheckbox.checked;
                    });
                    updateDeleteSelectionState();
                });
            }

            tableBody.addEventListener('change', (e) => {
                if (e.target.classList.contains('inventory-checkbox')) {
                    updateDeleteSelectionState();
                }
            });
            
            updateDeleteSelectionState();
        }
    }

    // --- Mini-Cart Logic ---
    const miniCart = document.querySelector('.mini-cart');
    const miniCartOverlay = document.querySelector('.mini-cart-overlay');
    const miniCartBody = document.querySelector('.mini-cart-body');
    const miniCartCount = document.querySelector('.mini-cart-count');
    const closeBtn = document.querySelector('.mini-cart .btn-close');

    const showMiniCart = () => {
        miniCart.classList.add('is-active');
        miniCartOverlay.classList.add('is-active');
    };

    const hideMiniCart = () => {
        miniCart.classList.remove('is-active');
        miniCartOverlay.classList.remove('is-active');
    };

    if (closeBtn) closeBtn.addEventListener('click', hideMiniCart);
    if (miniCartOverlay) miniCartOverlay.addEventListener('click', hideMiniCart);

    document.body.addEventListener('submit', function(e) {
        if (e.target && e.target.matches('form[action="/cart/add"]')) {
            e.preventDefault();
            const form = e.target;
            const formData = new FormData(form);

            fetch('/cart/add', {
                method: 'POST',
                body: new URLSearchParams(formData),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Update main cart badges
                    const mainCartBadges = document.querySelectorAll('.cart-badge');
                    mainCartBadges.forEach(badge => {
                        badge.textContent = data.cart.totalQty;
                        badge.style.display = data.cart.totalQty > 0 ? 'flex' : 'none';
                    });
                    
                    // Update mini cart
                    const item = data.addedItem;
                    miniCartBody.innerHTML = `
                        <div class="d-flex align-items-center">
                            <img src="${item.thumbnailUrl}" alt="${item.name}" class="img-fluid rounded-2 me-3" style="width: 80px; height: 80px; object-fit: contain; background-color: var(--bg-color);">
                            <div>
                                <h6 class="mb-1">${item.name}</h6>
                                <p class="text-body-secondary small mb-1">Size: ${item.size}</p>
                                <p class="fw-semibold mb-0">${locationData.symbol}${item.convertedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                        </div>
                    `;
                    if (miniCartCount) miniCartCount.textContent = data.cart.totalQty;
                    
                    // Show mini cart
                    showMiniCart();

                    // Close any open modals
                    const openModal = document.querySelector('.modal.show');
                    if (openModal) {
                        const modalInstance = bootstrap.Modal.getInstance(openModal);
                        if (modalInstance) {
                            modalInstance.hide();
                        }
                    }
                }
            })
            .catch(error => console.error('Error adding to cart:', error));
        }
    });

    // --- Mobile Cart Checkout Button Logic ---
    const mobileCheckoutBtn = document.getElementById('mobile-checkout-btn');
    const checkoutOptions = document.getElementById('checkout-options');

    if (mobileCheckoutBtn && checkoutOptions) {
        mobileCheckoutBtn.addEventListener('click', function() {
            this.style.display = 'none'; // Hide the main button
            checkoutOptions.classList.add('is-active');
        });

        document.addEventListener('click', function(event) {
            if (!mobileCheckoutBtn.contains(event.target) && !checkoutOptions.contains(event.target)) {
                mobileCheckoutBtn.style.display = 'block'; // Show the main button again
                checkoutOptions.classList.remove('is-active');
            }
        });
    }

    // --- Checkout Page Interactivity ---
    const checkoutContainer = document.querySelector('.checkout-container');
    if (checkoutContainer) {
        // Delivery method toggle
        const deliveryRadios = document.querySelectorAll('input[name="delivery-method"]');
        const shippingForm = document.getElementById('shipping-form');
        const pickupForm = document.getElementById('pickup-form');
        deliveryRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.value === 'ship') {
                    shippingForm.classList.remove('d-none');
                    pickupForm.classList.add('d-none');
                } else {
                    shippingForm.classList.add('d-none');
                    pickupForm.classList.remove('d-none');
                }
            });
        });

        // Payment method toggle
        const paymentRadios = document.querySelectorAll('input[name="payment-method"]');
        const paymentDetails = document.querySelectorAll('.payment-details-content');
        const ccFields = document.querySelectorAll('#payment-details-cc [name^="cc-"]');

        paymentRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                paymentDetails.forEach(detail => detail.classList.add('d-none'));
                const selectedDetail = document.getElementById(`payment-details-${this.value}`);
                if (selectedDetail) {
                    selectedDetail.classList.remove('d-none');
                }
                const isCCSelected = this.value === 'cc';
                ccFields.forEach(field => {
                    field.required = isCCSelected;
                });
            });
        });
        document.querySelector('input[name="payment-method"]:checked').dispatchEvent(new Event('change'));

        // Phone number field initialization
        const phoneInput = document.querySelector("#phone");
        if (phoneInput) {
            window.intlTelInput(phoneInput, {
                initialCountry: "auto",
                geoIpLookup: function(callback) {
                    fetch("https://ipapi.co/json")
                        .then(res => res.json())
                        .then(data => callback(data.country_code))
                        .catch(() => callback("us"));
                },
                utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8/js/utils.js",
            });
        }

        // Billing address checkbox logic
        const sameAsShippingCheckbox = document.getElementById('sameAsShipping');
        const billingAddressForm = document.getElementById('billing-address-form');
        const billingInputs = billingAddressForm.querySelectorAll('input, select');

        const toggleBillingForm = () => {
            if (sameAsShippingCheckbox.checked) {
                billingAddressForm.classList.add('d-none');
                billingInputs.forEach(input => input.required = false);
            } else {
                billingAddressForm.classList.remove('d-none');
                billingInputs.forEach(input => input.required = true);
            }
        };

        sameAsShippingCheckbox.addEventListener('change', toggleBillingForm);
        toggleBillingForm(); // Set initial state on page load
    }
});